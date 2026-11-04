import { MAX_UPLOAD_LABEL } from "@repo/validation";
import {
  pickAndUploadImage,
  uploadFailureReason,
} from "@/lib/chat/attachment-upload";

/**
 * Pick an image and make it the chapter's logo, from chapter setup's live
 * step (#3351). The same three wire steps as web's Settings → Chapter card
 * (`useUploadChapterLogo`): mint a signed URL, PUT the bytes, confirm the path.
 * The PUT is `pickAndUploadImage`'s `FileSystem.uploadAsync`, because a
 * `file://` URI is not a DOM `Blob` (`profile-photo.ts` has the same split).
 *
 * It runs after the chapter exists, because the routes act on the active
 * chapter. The crop is square: every surface draws the mark in a square tile.
 * It never throws; a failure comes back as a sentence for the screen to show,
 * the API's own words when it refused (`uploadFailureReason`).
 */

export interface ChapterLogoMutations {
  requestUploadUrl: (body: {
    filename: string;
    content_type: string;
  }) => Promise<unknown>;
  confirm: (storagePath: string) => Promise<unknown>;
}

export type ChapterLogoResult =
  | { status: "cancelled" }
  | { status: "updated" }
  | { status: "refused"; reason: string };

export const LOGO_TYPE_REFUSAL = "Logos can be JPEG, PNG, GIF or WebP.";
export const LOGO_SIZE_REFUSAL = `Logos can be up to ${MAX_UPLOAD_LABEL}.`;

/** See the module header. Never rejects. */
export async function pickAndSetChapterLogo(
  mutations: ChapterLogoMutations,
): Promise<ChapterLogoResult> {
  const upload = await pickAndUploadImage({
    kind: "image",
    cropSquare: true,
    // The pipeline sends `size_bytes`, which the logo route forbids, so only
    // the two fields it declares go through.
    requestUploadUrl: ({ filename, content_type }) =>
      mutations.requestUploadUrl({ filename, content_type }),
    copy: {
      askAccess: "Frapp needs access to your photos to add a logo.",
      settingsAccess: "Allow photo access for Frapp in Settings to add a logo.",
      type: LOGO_TYPE_REFUSAL,
      size: LOGO_SIZE_REFUSAL,
    },
  });
  if (upload.status !== "uploaded") return upload;
  try {
    await mutations.confirm(upload.image.storagePath);
    return { status: "updated" };
  } catch (err) {
    return { status: "refused", reason: uploadFailureReason(err) };
  }
}
