import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
import { describeChatPhoto } from "./photo-preview";
import { definitiveRefusalMessage } from "@repo/chat-core/chat-client";
import {
  MAX_UPLOAD_LABEL,
  inspectUploadFile,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  mimeForUploadFile,
  readPreviewUpload,
  readSignedUpload,
  type UploadKind,
} from "@repo/validation";

/**
 * Pick photos and put each in the bucket, returning the claim a send carries.
 *
 * This is the mobile half of the upload path web has had since the chat
 * rework; `apps/web/components/chat/composer.tsx`'s `handleAttach` is the
 * shape being ported, and the three wire steps are identical — mint a signed
 * URL, PUT the bytes, hand back an `OutboxAttachment` for the send to claim.
 * Nothing changes server-side for this: `POST /v1/channels/{id}/upload-url`
 * already authorizes with the same `assertChannelAccess(… 'post')` the send
 * uses, and `ChatAttachmentService.persistAttachments` already turns a claimed
 * `storage_path` into a `chat_message_attachments` row.
 *
 * ## Why this is not a hook
 *
 * The signed-URL mint is a TanStack mutation the calling screen already holds,
 * so it arrives as {@link RequestUploadUrl} rather than being called here.
 * That keeps this module a plain async function: testable without a renderer,
 * and callable from a handler rather than only from a component body.
 *
 * ## The bytes land before the message is queued
 *
 * The object is in the bucket the moment an upload resolves, which is why the
 * return value is a *claim* and not a file. A send can go up while its photos
 * still upload (the optimistic row waits on the claims, `use-chat-channel.ts`),
 * but nothing reaches the outbox or the server without them. Removing an
 * uploaded photo from the tray drops the claim, not the object, and an
 * abandoned composer leaves the object unreferenced. Nothing collects an upload that no message ever claimed, so it
 * stays there as an orphan until #2197's sweep exists. Web took this trade
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
 *
 * ## Camera photos are shrunk
 *
 * The one re-encode that is not about the type: a camera photo (a JPEG, or the
 * HEIC transcode) larger than `PHOTO_MAX_EDGE` is brought down to it at
 * `PHOTO_JPEG_QUALITY`. A full-size phone photo is 4 MB and up, and sending it
 * was most of a slow upload. PNG, GIF and WebP are never touched, for the
 * reasons above.
 */

/** The mutation the screen already holds, narrowed to what this needs. */
export type RequestUploadUrl = (args: {
  id: string;
  body: {
    filename: string;
    content_type: string;
    size_bytes?: number;
    with_preview?: boolean;
  };
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
 * The name a member sees on the attachment: the picked file's own basename,
 * with any query string and directory part a picker URI carries stripped off.
 *
 * Characters are left alone, so `Café.jpg` is shown as `Café.jpg`, as it is
 * when web sends the same photo. Neither caller's storage key is built from
 * this name as is. A chat attachment's key ends in the API's
 * `safeObjectFilename` of it (`apps/api/src/domain/constants/storage.ts`),
 * which replaces what storage-api would refuse. A profile photo's key is a
 * fresh `<uuid>.<ext>`, so only its extension reaches the key. Before #2697 the
 * chat key took the raw basename, and this function's squash to
 * `[A-Za-z0-9._-]` was what kept a non-ASCII name uploadable (#2783).
 *
 * Surrounding whitespace is trimmed, because the profile-photo path depends on
 * it. The extension allowlist trims before it looks (`normalizeExtension`), but
 * the avatar route puts the untrimmed extension into the key. So `beach.jpg`
 * with a trailing no-break space would pass every check and mint a key that
 * storage-api refuses.
 */
export function safeBasename(value: string, fallback: string): string {
  const withoutQuery = value.split("?")[0] ?? value;
  const last = (withoutQuery.split("/").pop() ?? "").trim();
  return last.length > 0 && last !== "." ? last : fallback;
}

/**
 * Resolve the type to declare, transcoding only when nothing allowlisted fits.
 *
 * Exported for its own spec: the branch that decides *not* to transcode is the
 * one protecting GIF animation and PNG transparency, and it is worth pinning
 * separately from the upload plumbing around it.
 */
export async function resolveUploadable(
  asset: {
    uri: string;
    fileName?: string | null;
    mimeType?: string;
    /** The picked photo's pixel size and bytes, when the picker reports them. */
    width?: number;
    height?: number;
    fileSize?: number;
  },
  /**
   * The allowlist the upload is checked against. Chat attachments are
   * `document`; a profile photo is `image` (#732). For a picked photo the two
   * accept the same four image types, but naming the kind keeps the gate and
   * this decision reading from one list.
   */
  kind: UploadKind = "document",
): Promise<{ uri: string; filename: string; contentType: string }> {
  const filename = safeBasename(asset.fileName ?? asset.uri, "photo.jpg");

  // `asset.mimeType` is optional and, on Android, occasionally a generic
  // `application/octet-stream`, so the extension map gets a say too — it is
  // what `mimeForUploadFile` prefers for exactly this reason.
  const declared =
    asset.mimeType && isAllowedUploadMime(kind, asset.mimeType)
      ? asset.mimeType
      : mimeForUploadFile(kind, {
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
  if (declared && isAllowedUploadExtension(kind, filename)) {
    // A camera JPEG is the one allowlisted type worth shrinking: no
    // transparency or animation to lose, and a phone's 12-48 MP original is
    // most of what made an upload slow (see `PHOTO_MAX_EDGE`).
    if (declared === "image/jpeg" && isOversizedPhoto(asset)) {
      const shrunk = await encodeJpeg(asset);
      return { uri: shrunk, filename, contentType: "image/jpeg" };
    }
    return { uri: asset.uri, filename, contentType: declared };
  }

  // Nothing allowlisted matched — HEIC from the iOS library is the case this
  // exists for. Re-encode so the bytes match what we are about to declare,
  // shrunk on the way like any other camera photo.
  const jpeg = await encodeJpeg(asset);
  const base = filename.replace(/\.[^.]*$/, "");
  return {
    uri: jpeg,
    filename: `${base.length > 0 ? base : "photo"}.jpg`,
    contentType: "image/jpeg",
  };
}

/**
 * The longest edge, in pixels, a picked camera photo is uploaded at.
 *
 * A phone photo is 12 to 48 MP. Re-encoded at full size and quality 1.0, as
 * the HEIC transcode used to, it came to 4 MB and more, every byte of it sent
 * before the member saw anything happen. 2560 px is sharper than any screen
 * Frapp draws it on and keeps a photographed page of minutes legible when
 * zoomed, at a few hundred KB. Chat apps send smaller still.
 */
export const PHOTO_MAX_EDGE = 2560;

/** JPEG quality for a re-encoded photo: no visible loss at this size. */
export const PHOTO_JPEG_QUALITY = 0.8;

/** A JPEG this many bytes or more is re-encoded even when its size is unknown. */
const PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;

function isOversizedPhoto(asset: {
  width?: number;
  height?: number;
  fileSize?: number;
}): boolean {
  const edge = Math.max(asset.width ?? 0, asset.height ?? 0);
  return edge > PHOTO_MAX_EDGE || (asset.fileSize ?? 0) > PHOTO_MAX_BYTES;
}

/**
 * Re-encode a photo as JPEG, its longest edge brought down to
 * {@link PHOTO_MAX_EDGE} when it is larger, at {@link PHOTO_JPEG_QUALITY}.
 * Returns the new file's URI.
 */
async function encodeJpeg(asset: {
  uri: string;
  width?: number;
  height?: number;
}): Promise<string> {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const context = ImageManipulator.manipulate(asset.uri);
  // One side is enough: the manipulator keeps the aspect ratio.
  if (Math.max(width, height) > PHOTO_MAX_EDGE) {
    context.resize(
      width >= height ? { width: PHOTO_MAX_EDGE } : { height: PHOTO_MAX_EDGE },
    );
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: PHOTO_JPEG_QUALITY,
  });
  return saved.uri;
}

/** The byte size of `uri`: `hinted` when the caller has one for these exact bytes, else read from disk. */
async function byteSizeOf(
  uri: string,
  hinted?: number,
): Promise<number> {
  if (typeof hinted === "number" && Number.isFinite(hinted) && hinted >= 0) {
    return hinted;
  }
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === "number" ? info.size : 0;
}

/** What a pick needs from its caller: the gate, the crop, and its words. */
export interface ImagePickOptions {
  /** The allowlist the pick is gated on and transcoded towards. */
  kind: UploadKind;
  /** Square-crop in the picker. Re-encodes, so a GIF keeps one frame. */
  cropSquare?: boolean;
  /** The sentences a refusal reads as, in the caller's own words. */
  copy: {
    /** Library access was refused and the prompt can be shown again. */
    askAccess: string;
    /** Refused for good: only the Settings app can grant it now. */
    settingsAccess: string;
    type: string;
    size: string;
  };
}

/** What a pick-and-upload needs from its caller, beyond the bytes. */
export interface ImageUploadOptions extends ImagePickOptions {
  /** Mints the signed URL; the caller holds the mutation and its route. */
  requestUploadUrl: RequestSignedUpload;
}

/** Mints a signed URL for one file; the caller holds the mutation and its route. */
export type RequestSignedUpload = (body: {
  filename: string;
  content_type: string;
  size_bytes: number;
  /** Also mint a URL for a preview copy (chat photos only). */
  with_preview?: boolean;
}) => Promise<unknown>;

/**
 * A photo the member picked that passed the gate, still only on the device:
 * the bytes at `uri` are the ones to PUT, under `contentType`.
 */
export interface PickedImage {
  uri: string;
  filename: string;
  contentType: string;
  byteSize: number;
}

export type ImagePickResult =
  | { status: "cancelled" }
  | { status: "picked"; image: PickedImage }
  | { status: "refused"; reason: string };

/** The upload finished; the object is in the bucket at `storagePath`. */
export interface UploadedImage {
  storagePath: string;
  filename: string;
  contentType: string;
  byteSize: number;
  /** Where the preview copy landed, when one was asked for and arrived. */
  previewStoragePath?: string;
}

export type ImageUploadResult =
  | { status: "cancelled" }
  | { status: "uploaded"; image: UploadedImage }
  | { status: "refused"; reason: string };

const UPLOAD_FAILED =
  "Couldn't upload that photo. Try again in a moment.";

/** A pick that threw: an unguarded native call, read as a sentence. */
const PICK_FAILED = "Couldn't add that photo. Try again in a moment.";

/**
 * The sentence to show for a failed request.
 *
 * `@repo/hooks` mutations throw the API's error body, a plain object carrying
 * the `statusCode` and a `message`. A definitive refusal's message is the API's
 * reason for a member to read, read by the same `definitiveRefusalMessage` the
 * web composer uses, so one response reads the same on both (#2199). A 429
 * reads as its rate-limit sentence, a wait of a minute. A 5xx's body is
 * framework text ("Internal server error"), and a thrown `Error` is a native
 * networking failure or a parse error in platform jargon; each reads as the
 * generic sentence, which says to try again in a moment.
 */
export function uploadFailureReason(err: unknown): string {
  return definitiveRefusalMessage(err) ?? UPLOAD_FAILED;
}

/** A library asset as the picker hands it back, narrowed to what is read. */
type LibraryAsset = ImagePicker.ImagePickerAsset;

/**
 * Ask for library access and open the picker. `limit` above 1 turns on
 * multi-select, in the order the member tapped.
 */
async function launchLibrary(
  options: ImagePickOptions,
  limit: number,
): Promise<
  | { status: "cancelled" }
  | { status: "refused"; reason: string }
  | { status: "picked"; assets: LibraryAsset[] }
> {
  const { copy } = options;
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      status: "refused",
      reason: permission.canAskAgain ? copy.askAccess : copy.settingsAccess,
    };
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    // Off for chat: the crop UI is not drawn there, and on Android it silently
    // re-encodes, which would defeat the conditional transcode above. On for a
    // profile photo, which every surface draws in a circle.
    ...(options.cropSquare ? { allowsEditing: true, aspect: [1, 1] } : {}),
    ...(limit > 1
      ? {
          allowsMultipleSelection: true,
          selectionLimit: limit,
          orderedSelection: true,
        }
      : { allowsMultipleSelection: false }),
  });
  if (picked.canceled) return { status: "cancelled" };
  const assets = (picked.assets ?? []).slice(0, limit);
  if (assets.length === 0) return { status: "cancelled" };
  return { status: "picked", assets };
}

/**
 * Turn one picked asset into the bytes to PUT: transcode or shrink when
 * `resolveUploadable` says to, then gate type and size. Throws only from the
 * native calls; {@link pickImage} and {@link uploadChatPhoto} guard it.
 */
async function preparePickedAsset(
  asset: LibraryAsset,
  options: ImagePickOptions,
): Promise<
  | { status: "picked"; image: PickedImage }
  | { status: "refused"; reason: string }
> {
  const { kind, copy } = options;
  let uploadable: Awaited<ReturnType<typeof resolveUploadable>>;
  try {
    uploadable = await resolveUploadable(asset, kind);
  } catch {
    return { status: "refused", reason: copy.type };
  }

  // `asset.fileSize` describes what the member picked. If `resolveUploadable`
  // transcoded or shrank it, the bytes about to be PUT are a *different file*
  // (a re-encode can come out larger than the original as well as smaller),
  // so trusting the hint there would gate on the wrong number, declare
  // the wrong `size_bytes`, and record the wrong `byteSize` on every iOS photo.
  const size = await byteSizeOf(
    uploadable.uri,
    uploadable.uri === asset.uri ? asset.fileSize : undefined,
  );

  // Gate before minting, so an oversized or wrong-typed pick costs no request
  // and reads as a sentence rather than a raw storage error.
  const inspected = inspectUploadFile(kind, {
    name: uploadable.filename,
    type: uploadable.contentType,
    size,
  });
  if (!inspected.ok) {
    return {
      status: "refused",
      reason: inspected.reason === "size" ? copy.size : copy.type,
    };
  }

  return {
    status: "picked",
    image: {
      uri: uploadable.uri,
      filename: uploadable.filename,
      contentType: inspected.contentType,
      byteSize: size,
    },
  };
}

async function pickImageUnguarded(
  options: ImagePickOptions,
): Promise<ImagePickResult> {
  const launched = await launchLibrary(options, 1);
  if (launched.status !== "picked") return launched;
  return preparePickedAsset(launched.assets[0]!, options);
}

/**
 * Pick one photo from the library and gate it, uploading nothing.
 *
 * Split from the upload for a caller that shows the pick before sending it:
 * s21 (`components/documents/upload-document-sheet.tsx`) lets the member title
 * and file the photo first, and a sheet cancelled at that point must leave no
 * object in the bucket.
 *
 * The contract is that this never throws, so it is enforced in one place.
 * Three awaits can reject for reasons a member can actually hit:
 * `requestMediaLibraryPermissionsAsync` and `launchImageLibraryAsync` (Android
 * rejects a second launch while one is already open), and `getInfoAsync` on
 * an asset the picker could not materialize — a limited-permission iOS library
 * pick, or a provider URI. Guarding each one individually is the version of
 * this that rots: the next await added above inherits nothing. A rejection
 * escaping here would reach a screen's fire-and-forget handler and become an
 * unhandled rejection, which on this platform means no hint and a spinner
 * that simply stops.
 */
export async function pickImage(
  options: ImagePickOptions,
): Promise<ImagePickResult> {
  try {
    return await pickImageUnguarded(options);
  } catch {
    return { status: "refused", reason: PICK_FAILED };
  }
}

/**
 * PUT a picked photo to a freshly minted signed URL. Never throws: a refused
 * mint or a failed PUT comes back as a sentence.
 */
export async function uploadPickedImage(
  image: PickedImage,
  requestUploadUrl: RequestSignedUpload,
  /**
   * A local JPEG to upload beside the image as its preview copy (chat photos,
   * `photo-preview.ts`). Best effort: a preview that fails to upload is left
   * out of the result, and the image is still uploaded.
   */
  previewUri: string | null = null,
): Promise<Exclude<ImageUploadResult, { status: "cancelled" }>> {
  try {
    const ticket = await requestUploadUrl({
      filename: image.filename,
      content_type: image.contentType,
      // Declared so the API's own 25 MB check runs and answers with a
      // readable 400 instead of the bucket's raw one.
      size_bytes: image.byteSize,
      ...(previewUri ? { with_preview: true } : {}),
    });
    const { signedUrl, storagePath } = readSignedUpload(ticket);
    const previewTicket = previewUri ? readPreviewUpload(ticket) : null;

    // Both PUTs at once: the preview is a fraction of the original's bytes,
    // so it adds next to nothing to the wait.
    const [ok, previewOk] = await Promise.all([
      putFile(signedUrl, image.uri, image.contentType),
      previewTicket && previewUri
        ? putFile(previewTicket.signedUrl, previewUri, "image/jpeg").catch(
            () => false,
          )
        : false,
    ]);
    if (!ok) {
      return { status: "refused", reason: UPLOAD_FAILED };
    }

    return {
      status: "uploaded",
      image: {
        storagePath,
        filename: image.filename,
        contentType: image.contentType,
        byteSize: image.byteSize,
        ...(previewOk && previewTicket
          ? { previewStoragePath: previewTicket.storagePath }
          : {}),
      },
    };
  } catch (err) {
    return { status: "refused", reason: uploadFailureReason(err) };
  }
}


/** PUT the file at `uri` to a signed upload URL; true on a 2xx. */
async function putFile(
  signedUrl: string,
  uri: string,
  contentType: string,
): Promise<boolean> {
  // `useUploadSignedUrl` in `@repo/hooks` is not reachable from here: it
  // PUTs a DOM `File`, which React Native has no equivalent of for a
  // `file://` URI. `uploadAsync` with BINARY_CONTENT is the same request
  // — raw bytes, one Content-Type header — made from a URI instead.
  const response = await FileSystem.uploadAsync(signedUrl, uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType },
    // `uploadAsync` defaults to a BACKGROUND session, which on iOS hands
    // the request to the system's background transfer daemon: it is built
    // to survive the app being suspended, not to be quick, and it added
    // seconds to every upload while the member watched. The trade: a
    // foreground task stops if the app is suspended mid-PUT, and the caller
    // reports a failure the member can retry (s12's pending row does). With
    // photos shrunk first (`PHOTO_MAX_EDGE`) a PUT is a second or two.
    sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
  });
  return response.status >= 200 && response.status < 300;
}

/**
 * Pick one photo from the library and PUT it to a freshly minted signed URL:
 * the pipeline the profile photo and the chapter logo
 * ({@link pickUploadAndConfirmImage}) share. It is {@link pickImage} then
 * {@link uploadPickedImage}, and like both it never throws. Chat picks several
 * at once ({@link pickChatPhotos}) and uploads each in the background
 * ({@link uploadChatPhoto}); all of them share `launchLibrary`,
 * `preparePickedAsset` and {@link uploadPickedImage}, so a fix to a step there
 * reaches every caller.
 */
async function pickAndUploadImage(
  options: ImageUploadOptions,
): Promise<ImageUploadResult> {
  const picked = await pickImage(options);
  if (picked.status !== "picked") return picked;
  return uploadPickedImage(picked.image, options.requestUploadUrl);
}

/** How a pick, upload and confirm ended. */
export type ConfirmedImageResult =
  | { status: "cancelled" }
  | { status: "updated" }
  | { status: "refused"; reason: string };

/**
 * {@link pickAndUploadImage}, then `confirm` the uploaded path: the whole flow
 * for an image that replaces one thing, the profile photo
 * (`lib/more/profile-photo.ts`) and the chapter logo
 * (`lib/onboarding/chapter-wizard/chapter-logo.ts`). Never rejects; a refused
 * confirm reads as `uploadFailureReason`'s sentence.
 */
export async function pickUploadAndConfirmImage(
  options: ImageUploadOptions & {
    confirm: (storagePath: string) => Promise<unknown>;
  },
): Promise<ConfirmedImageResult> {
  const { confirm, ...upload } = options;
  const result = await pickAndUploadImage(upload);
  if (result.status !== "uploaded") return result;
  try {
    await confirm(result.image.storagePath);
    return { status: "updated" };
  } catch (err) {
    return { status: "refused", reason: uploadFailureReason(err) };
  }
}

/** The most photos one chat pick stages: iMessage and Discord both stop at 10. */
export const CHAT_PHOTO_LIMIT = 10;

const CHAT_COPY: ImagePickOptions["copy"] = {
  askAccess: "Frapp needs access to your photos to send one.",
  settingsAccess: "Allow photo access for Frapp in Settings to send a photo.",
  type: TYPE_REFUSAL,
  size: SIZE_REFUSAL,
};

/**
 * A photo the member picked for chat, still only on the device.
 *
 * `previewUri` is the picker's own file, which the composer tray and the
 * sender's own message draw at once. Nothing is transcoded, shrunk or
 * uploaded yet: that is {@link uploadChatPhoto}, run in the background so
 * the tray shows the picture the moment the picker closes.
 */
export interface PickedChatPhoto {
  previewUri: string;
  width: number | null;
  height: number | null;
  /** The picker's asset, handed back to {@link uploadChatPhoto}. */
  asset: LibraryAsset;
}

export type ChatPhotoPickResult =
  | { status: "cancelled" }
  | { status: "picked"; photos: PickedChatPhoto[] }
  | { status: "refused"; reason: string };

/**
 * Open the library for up to `limit` photos. Never throws. Uploads nothing:
 * a photo removed from the tray before its upload starts costs no request.
 */
export async function pickChatPhotos(
  limit: number = CHAT_PHOTO_LIMIT,
): Promise<ChatPhotoPickResult> {
  if (limit < 1) return { status: "cancelled" };
  try {
    const launched = await launchLibrary(
      { kind: "document", copy: CHAT_COPY },
      limit,
    );
    if (launched.status !== "picked") return launched;
    return {
      status: "picked",
      photos: launched.assets.map((asset) => ({
        previewUri: asset.uri,
        width: asset.width > 0 ? asset.width : null,
        height: asset.height > 0 ? asset.height : null,
        asset,
      })),
    };
  } catch {
    return { status: "refused", reason: PICK_FAILED };
  }
}

/**
 * Prepare one picked photo (transcode or shrink, then gate) and PUT it to a
 * signed URL minted for `channelId`, returning the claim a send carries.
 * Never throws: every failure is a sentence for the tray.
 */
export async function uploadChatPhoto(
  channelId: string,
  photo: PickedChatPhoto,
  requestUploadUrl: RequestUploadUrl,
): Promise<AttachmentPickResult> {
  let prepared: Awaited<ReturnType<typeof preparePickedAsset>>;
  try {
    prepared = await preparePickedAsset(photo.asset, {
      kind: "document",
      copy: CHAT_COPY,
    });
  } catch {
    return { status: "refused", reason: PICK_FAILED };
  }
  if (prepared.status !== "picked") return prepared;
  // Size, placeholder and preview copy, from the exact bytes being uploaded
  // (after any shrink or transcode). Never throws; anything it could not make
  // is simply not sent, and readers fall back to the original.
  const described = await describeChatPhoto(
    prepared.image.uri,
    prepared.image.contentType,
  );
  const result = await uploadPickedImage(
    prepared.image,
    (body) => requestUploadUrl({ id: channelId, body }),
    described.previewUri,
  );
  if (result.status !== "uploaded") return result;
  return {
    status: "attached",
    attachment: {
      ...result.image,
      width: described.width,
      height: described.height,
      thumbhash: described.thumbhash,
    },
  };
}
