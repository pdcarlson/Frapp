import { MAX_UPLOAD_LABEL } from "@repo/validation";
import {
  pickAndUploadImage,
  uploadFailureReason,
} from "@/lib/chat/attachment-upload";

/**
 * Pick a photo from the library and make it the member's profile photo (#732).
 *
 * The same three wire steps as web's `ProfilePhotoControl`: mint a signed URL
 * for the member's folder in the active chapter, PUT the bytes, confirm the
 * path. The PUT is `FileSystem.uploadAsync` rather than `putSignedUpload`,
 * for the reason `attachment-upload.ts` gives: React Native has no DOM `File`
 * for a `file://` URI.
 *
 * The picker crops to a square, because every surface draws the photo in a
 * circle and an uncropped portrait would lose the face to the mask. Cropping
 * re-encodes, which flattens a GIF to one frame; that is fine for an avatar,
 * unlike a chat attachment. HEIC is still transcoded by `resolveUploadable`.
 *
 * The pick and the PUT are `pickAndUploadImage`, the pipeline chat
 * attachments use; this adds the crop, the `image` kind, its own copy, and the
 * confirm. It never throws: the profile screen has no toast, so every failure
 * comes back as a sentence to show under the photo, the API's own words when
 * it refused (`uploadFailureReason`).
 */

/** The two mutations the screen holds, narrowed to what this needs. */
export interface ProfilePhotoMutations {
  requestUploadUrl: (body: {
    filename: string;
    content_type: string;
    size_bytes: number;
  }) => Promise<unknown>;
  confirm: (storagePath: string) => Promise<unknown>;
}

export type ProfilePhotoResult =
  | { status: "cancelled" }
  | { status: "updated" }
  | { status: "refused"; reason: string };

export const PHOTO_TYPE_REFUSAL =
  "Profile photos can be JPEG, PNG, GIF or WebP.";
export const PHOTO_SIZE_REFUSAL = `Profile photos can be up to ${MAX_UPLOAD_LABEL}.`;

/** See the module header. Never rejects. */
export async function pickAndSetProfilePhoto(
  mutations: ProfilePhotoMutations,
): Promise<ProfilePhotoResult> {
  const upload = await pickAndUploadImage({
    kind: "image",
    cropSquare: true,
    requestUploadUrl: mutations.requestUploadUrl,
    copy: {
      askAccess: "Frapp needs access to your photos to set one.",
      settingsAccess: "Allow photo access for Frapp in Settings to set a photo.",
      type: PHOTO_TYPE_REFUSAL,
      size: PHOTO_SIZE_REFUSAL,
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
