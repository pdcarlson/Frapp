import { errorCopy } from "@repo/hooks/error-copy";
import { MAX_UPLOAD_LABEL, type ChatBackgroundKey } from "@repo/validation";
import {
  pickAndUploadImage,
  type ImageUploadResult,
} from "@/lib/chat/attachment-upload";

/**
 * Pick a photo for a chat background (#4031) and upload it, leaving the save
 * to the caller (`useSetChannelBackground` / `useSetChapterChatBackground`
 * with the returned `storagePath`).
 *
 * The same pipeline as the profile photo and chat photos, so HEIC is
 * transcoded and a large photo shrunk (`resolveUploadable`) before it is
 * gated against the `image` allowlist. No crop: a background fills a whole
 * phone or browser window, and the thread blurs it anyway.
 *
 * The photo-url routes take only `filename` and `content_type`, and the API
 * 400s an undeclared field, so `size_bytes` is dropped here; the client-side
 * gate has already checked the size. Never throws.
 */
export const BACKGROUND_TYPE_REFUSAL =
  "Backgrounds can be JPEG, PNG, GIF or WebP.";
export const BACKGROUND_SIZE_REFUSAL = `Background photos can be up to ${MAX_UPLOAD_LABEL}.`;

export type RequestBackgroundPhotoUrl = (args: {
  filename: string;
  contentType: string;
}) => Promise<unknown>;

export function pickAndUploadChatBackgroundPhoto(
  requestPhotoUrl: RequestBackgroundPhotoUrl,
): Promise<ImageUploadResult> {
  return pickAndUploadImage({
    kind: "image",
    requestUploadUrl: ({ filename, content_type }) =>
      requestPhotoUrl({ filename, contentType: content_type }),
    copy: {
      askAccess: "Frapp needs access to your photos to set a background.",
      settingsAccess:
        "Allow photo access for Frapp in Settings to set a background.",
      type: BACKGROUND_TYPE_REFUSAL,
      size: BACKGROUND_SIZE_REFUSAL,
    },
  });
}

/** How a set from the phone ended: saved, cancelled at the picker, or a sentence to show. */
export type ChatBackgroundSaveResult =
  | { status: "saved" }
  | { status: "cancelled" }
  | { status: "refused"; reason: string };

export const BACKGROUND_SAVE_FAILED =
  "Couldn't change the background. Check your connection and try again.";

/**
 * The phone's set: a key or null saves at once; `photo` opens the library,
 * uploads, then saves the uploaded path. Never throws.
 */
export async function saveChatBackgroundPick(
  pick: ChatBackgroundKey | null,
  deps: {
    requestPhotoUrl: RequestBackgroundPhotoUrl;
    save: (args: {
      background: ChatBackgroundKey | null;
      storagePath?: string;
    }) => Promise<unknown>;
  },
): Promise<ChatBackgroundSaveResult> {
  let storagePath: string | undefined;
  if (pick === "photo") {
    const uploaded = await pickAndUploadChatBackgroundPhoto(
      deps.requestPhotoUrl,
    );
    if (uploaded.status !== "uploaded") return uploaded;
    storagePath = uploaded.image.storagePath;
  }
  try {
    await deps.save({ background: pick, storagePath });
    return { status: "saved" };
  } catch (err) {
    return {
      status: "refused",
      reason: errorCopy(err, BACKGROUND_SAVE_FAILED),
    };
  }
}
