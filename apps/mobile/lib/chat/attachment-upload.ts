import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
import {
  MAX_UPLOAD_LABEL,
  inspectUploadFile,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  mimeForUploadFile,
  readSignedUpload,
} from "@repo/validation";

/**
 * Pick a photo and put it in the bucket, returning the claim the next send
 * carries.
 *
 * This is the mobile half of the upload path web has had since the chat
 * rework; `apps/web/components/chat/composer.tsx`'s `handleAttach` is the
 * shape being ported, and the three wire steps are identical — mint a signed
 * URL, PUT the bytes, hand back an `OutboxAttachment` for the send to claim.
 * Nothing changes server-side for this: `POST /v1/channels/{id}/upload-url`
 * already authorizes with the same `assertChannelAccess(… 'post')` the send
 * uses, and `ChatService.persistAttachments` already turns a claimed
 * `storage_path` into a `chat_message_attachments` row.
 *
 * ## Why this is not a hook
 *
 * The signed-URL mint is a TanStack mutation the calling screen already holds,
 * so it arrives as {@link RequestUploadUrl} rather than being called here.
 * That keeps this module a plain async function: testable without a renderer,
 * and callable from a handler rather than only from a component body.
 *
 * ## The bytes land before the message exists
 *
 * The object is in the bucket the moment this resolves, which is why the
 * return value is a *claim* and not a file. Dropping the chip before sending
 * drops the claim, not the object, and an abandoned composer leaves the object
 * unreferenced for the storage retention pass. Web took this trade
 * deliberately (`composer.tsx`, "Files uploaded and waiting to be claimed by
 * the next send") because the alternative it replaced was worse: the only
 * record of the file was a string the sender could edit out of the body.
 *
 * ## Transcoding is conditional, and that is the point
 *
 * iOS hands back HEIC from the photo library, and `image/heic` is on neither
 * the `document` allowlist nor the chat bucket's `allowed_mime_types` — so the
 * mint 400s and, if it did not, the PUT would. But the naive fix, "re-encode
 * everything to JPEG", is quietly destructive: it flattens a transparent PNG
 * onto black and reduces an animated GIF to its first frame. A GIF sent as a
 * file is a feature that already works through the `document` kind
 * (`image/gif` is on it, pinned by a regression test), and silently killing
 * the animation would be a worse bug than the one being fixed.
 *
 * So the rule is: **upload what the member picked when its type is already
 * allowlisted, and transcode only when it is not.** The JPEG path exists for
 * HEIC/HEIF and for the case where nothing can determine a type at all.
 *
 * The transcode is also what makes the declared type *honest*. The bucket
 * gates the client-declared `Content-Type` header and never the bytes (see
 * `@repo/validation`'s `upload-allowlists.ts` header, measured against
 * storage-api). Declaring `image/jpeg` over HEIC bytes would therefore be
 * accepted, stored, and served — and then render as a broken image in
 * `message-attachments.tsx`. Re-encoding means the header is true.
 */

/** The mutation the screen already holds, narrowed to what this needs. */
export type RequestUploadUrl = (args: {
  id: string;
  body: { filename: string; content_type: string; size_bytes?: number };
}) => Promise<unknown>;

export type AttachmentPickResult =
  /** The member backed out of the picker, or declined the library. */
  | { status: "cancelled" }
  /** The bytes are in the bucket; `attachment` is the claim to send. */
  | { status: "attached"; attachment: OutboxAttachment }
  /**
   * Nothing was uploaded and the member needs to be told why, in one sentence
   * fit for the composer hint. Never a thrown error: the mobile composer has
   * no toast (chat-core's toasts are no-ops here), so an exception would be
   * invisible.
   */
  | { status: "refused"; reason: string };

/** Type + 25 MB gate copy, kept in the words web already uses. */
const TYPE_REFUSAL =
  "Chat accepts common images — JPEG, PNG, GIF and WebP (no SVG).";
const SIZE_REFUSAL = `Photos can be up to ${MAX_UPLOAD_LABEL}.`;

/**
 * Strip any directory part a picker URI or filename might carry.
 *
 * The API derives the storage path from this name, so a separator in it would
 * push the object outside the prefix `validateAttachmentInputs` re-checks the
 * claim against — a 400 at send time, long after the bytes were uploaded.
 */
export function safeBasename(value: string, fallback: string): string {
  const withoutQuery = value.split("?")[0] ?? value;
  const last = withoutQuery.split("/").pop() ?? "";
  const cleaned = last.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 && cleaned !== "." ? cleaned : fallback;
}

/**
 * Resolve the type to declare, transcoding only when nothing allowlisted fits.
 *
 * Exported for its own spec: the branch that decides *not* to transcode is the
 * one protecting GIF animation and PNG transparency, and it is worth pinning
 * separately from the upload plumbing around it.
 */
export async function resolveUploadable(asset: {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
}): Promise<{ uri: string; filename: string; contentType: string }> {
  const filename = safeBasename(asset.fileName ?? asset.uri, "photo.jpg");

  // `asset.mimeType` is optional and, on Android, occasionally a generic
  // `application/octet-stream`, so the extension map gets a say too — it is
  // what `mimeForUploadFile` prefers for exactly this reason.
  const declared =
    asset.mimeType && isAllowedUploadMime("document", asset.mimeType)
      ? asset.mimeType
      : mimeForUploadFile("document", {
          name: filename,
          type: asset.mimeType ?? "",
        });

  // Both halves, not just the MIME: `inspectUploadFile` downstream requires an
  // allowlisted extension as well, so accepting on the MIME alone would skip
  // the transcode for a file the gate then refuses anyway — and refuse it with
  // "Chat accepts common images", about an actual JPEG. A `photo.jfif` saved by
  // Chrome (`mimeType: "image/jpeg"`, extension off the list) and an asset with
  // no `fileName` at all both land here; iOS returns a null `fileName` for a
  // limited-permission library pick, which is not a rare path.
  if (declared && isAllowedUploadExtension("document", filename)) {
    return { uri: asset.uri, filename, contentType: declared };
  }

  // Nothing allowlisted matched — HEIC from the iOS library is the case this
  // exists for. Re-encode so the bytes match what we are about to declare.
  const rendered = await ImageManipulator.manipulate(asset.uri).renderAsync();
  const jpeg = await rendered.saveAsync({ format: SaveFormat.JPEG });
  const base = filename.replace(/\.[^.]*$/, "");
  return {
    uri: jpeg.uri,
    filename: `${base.length > 0 ? base : "photo"}.jpg`,
    contentType: "image/jpeg",
  };
}

async function byteSizeOf(uri: string, hinted?: number): Promise<number> {
  if (typeof hinted === "number" && Number.isFinite(hinted) && hinted >= 0) {
    return hinted;
  }
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === "number" ? info.size : 0;
}

async function pickAndUploadPhotoUnguarded(
  channelId: string,
  requestUploadUrl: RequestUploadUrl,
): Promise<AttachmentPickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      status: "refused",
      reason: permission.canAskAgain
        ? "Frapp needs access to your photos to send one."
        : "Allow photo access for Frapp in Settings to send a photo.",
    };
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    // No `allowsEditing`: it forces a crop UI the drawing does not call for,
    // and on Android it silently re-encodes, which would defeat the
    // conditional transcode above.
    allowsMultipleSelection: false,
  });
  if (picked.canceled) return { status: "cancelled" };

  const asset = picked.assets?.[0];
  if (!asset) return { status: "cancelled" };

  let uploadable: Awaited<ReturnType<typeof resolveUploadable>>;
  try {
    uploadable = await resolveUploadable(asset);
  } catch {
    return { status: "refused", reason: TYPE_REFUSAL };
  }

  // `asset.fileSize` describes what the member picked. If `resolveUploadable`
  // transcoded, the bytes about to be PUT are a *different file* — a
  // quality-1.0 JPEG re-encode of a 48MP HEIC is routinely larger than the
  // HEIC — so trusting the hint there would gate on the wrong number, declare
  // the wrong `size_bytes`, and record the wrong `byteSize` on every iOS photo.
  const size = await byteSizeOf(
    uploadable.uri,
    uploadable.uri === asset.uri ? asset.fileSize : undefined,
  );

  // Gate before minting, so an oversized or wrong-typed pick costs no request
  // and reads as a sentence rather than a raw storage error.
  const inspected = inspectUploadFile("document", {
    name: uploadable.filename,
    type: uploadable.contentType,
    size,
  });
  if (!inspected.ok) {
    return {
      status: "refused",
      reason: inspected.reason === "size" ? SIZE_REFUSAL : TYPE_REFUSAL,
    };
  }

  try {
    const ticket = await requestUploadUrl({
      id: channelId,
      body: {
        filename: uploadable.filename,
        content_type: inspected.contentType,
        // Declared so the API's own 25 MB check runs and answers with a
        // readable 400 instead of the bucket's raw one.
        size_bytes: size,
      },
    });
    const { signedUrl, storagePath } = readSignedUpload(ticket);

    // `useUploadSignedUrl` in `@repo/hooks` is not reachable from here: it
    // PUTs a DOM `File`, which React Native has no equivalent of for a
    // `file://` URI. `uploadAsync` with BINARY_CONTENT is the same request
    // — raw bytes, one Content-Type header — made from a URI instead.
    const response = await FileSystem.uploadAsync(signedUrl, uploadable.uri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": inspected.contentType },
    });
    if (response.status < 200 || response.status >= 300) {
      return {
        status: "refused",
        reason: "Couldn't upload that photo. Try again in a moment.",
      };
    }

    return {
      status: "attached",
      attachment: {
        storagePath,
        filename: uploadable.filename,
        contentType: inspected.contentType,
        byteSize: size,
      },
    };
  } catch (err) {
    return {
      status: "refused",
      reason:
        err instanceof Error && err.message.length > 0
          ? err.message
          : "Couldn't upload that photo. Try again in a moment.",
    };
  }
}

/**
 * The contract above says this never throws, so enforce that in one place.
 *
 * Three awaits sit outside the inner try blocks and can reject for reasons a
 * member can actually hit: `requestMediaLibraryPermissionsAsync` and
 * `launchImageLibraryAsync` (Android rejects a second launch while one is
 * already open), and `getInfoAsync` on an asset the picker could not
 * materialize — a limited-permission iOS library pick, or a provider URI.
 *
 * Guarding each one individually is the version of this that rots: the next
 * await added above inherits nothing. A rejection escaping here would reach the
 * screen's fire-and-forget IIFE and become an unhandled rejection, which on
 * this platform means no chip, no hint, and a spinner that simply stops — the
 * attach button appearing to do nothing at all.
 */
export async function pickAndUploadPhoto(
  channelId: string,
  requestUploadUrl: RequestUploadUrl,
): Promise<AttachmentPickResult> {
  try {
    return await pickAndUploadPhotoUnguarded(channelId, requestUploadUrl);
  } catch {
    return {
      status: "refused",
      reason: "Couldn't add that photo. Try again in a moment.",
    };
  }
}
