import { errorCopy } from "@repo/hooks/error-copy";
import { MAX_UPLOAD_LABEL, type ChatBackgroundKey } from "@repo/validation";
import {
  pickUploadAndConfirmImage,
  type ConfirmedImageResult,
} from "@/lib/chat/attachment-upload";

/**
 * Setting a chat background from the phone (#4031): the long-press menu's
 * Background view and Settings → Chat background both save through
 * {@link saveChatBackgroundPick}.
 */

export const BACKGROUND_TYPE_REFUSAL =
  "Backgrounds can be JPEG, PNG, GIF or WebP.";
export const BACKGROUND_SIZE_REFUSAL = `Background photos can be up to ${MAX_UPLOAD_LABEL}.`;
export const BACKGROUND_SAVE_FAILED =
  "Couldn't change the background. Check your connection and try again.";

/** Mints the signed URL on the background route for this scope (`useRequestChatBackgroundPhotoUrl`). */
export type RequestBackgroundPhotoUrl = (args: {
  filename: string;
  contentType: string;
}) => Promise<unknown>;

/** Saves the setting (`useSetChannelBackground` / `useSetChapterChatBackground`). */
export type SaveChatBackground = (args: {
  background: ChatBackgroundKey | null;
  storagePath?: string;
}) => Promise<unknown>;

/** How a set from the phone ended: saved, cancelled at the picker, or a sentence to show. */
export type ChatBackgroundSaveResult =
  | { status: "saved" }
  | { status: "cancelled" }
  | { status: "refused"; reason: string };

/**
 * Pick a photo, upload it and save it as the background: the shared
 * pick-upload-confirm pipeline the profile photo and chapter logo use
 * (`pickUploadAndConfirmImage`), so HEIC is transcoded and a large photo
 * shrunk before it is gated against the `image` allowlist, and a refused save
 * reads as `uploadFailureReason`'s sentence. No crop: a background fills a
 * whole window, and the thread blurs it anyway.
 *
 * The photo-url routes take only `filename` and `content_type`, and the API
 * 400s an undeclared field, so `size_bytes` is dropped here; the client-side
 * gate has already checked the size. Never throws.
 */
export function pickAndSetChatBackgroundPhoto(deps: {
  requestPhotoUrl: RequestBackgroundPhotoUrl;
  save: SaveChatBackground;
}): Promise<ConfirmedImageResult> {
  return pickUploadAndConfirmImage({
    kind: "image",
    requestUploadUrl: ({ filename, content_type }) =>
      deps.requestPhotoUrl({ filename, contentType: content_type }),
    confirm: (storagePath) => deps.save({ background: "photo", storagePath }),
    copy: {
      askAccess: "Frapp needs access to your photos to set a background.",
      settingsAccess:
        "Allow photo access for Frapp in Settings to set a background.",
      type: BACKGROUND_TYPE_REFUSAL,
      size: BACKGROUND_SIZE_REFUSAL,
    },
  });
}

/**
 * The phone's set: a key or null saves at once; `photo` opens the library,
 * uploads, then saves the uploaded path. Never throws.
 */
export async function saveChatBackgroundPick(
  pick: ChatBackgroundKey | null,
  deps: { requestPhotoUrl: RequestBackgroundPhotoUrl; save: SaveChatBackground },
): Promise<ChatBackgroundSaveResult> {
  if (pick === "photo") {
    const result = await pickAndSetChatBackgroundPhoto(deps);
    return result.status === "updated" ? { status: "saved" } : result;
  }
  try {
    await deps.save({ background: pick });
    return { status: "saved" };
  } catch (err) {
    return { status: "refused", reason: errorCopy(err, BACKGROUND_SAVE_FAILED) };
  }
}
