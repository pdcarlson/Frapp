import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import {
  MAX_UPLOAD_LABEL,
  inspectUploadFile,
  readSignedUpload,
} from "@repo/validation";
import { byteSizeOf, resolveUploadable } from "@/lib/chat/attachment-upload";

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
 * Like `pickAndUploadPhoto`, this never throws: the profile screen has no
 * toast, so every failure comes back as a sentence to show under the photo.
 */

/** The two mutations the screen holds, narrowed to what this needs. */
export interface ProfilePhotoMutations {
  requestUploadUrl: (body: {
    filename: string;
    content_type: string;
    size_bytes?: number;
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
const UPLOAD_FAILED = "Couldn't upload that photo. Try again in a moment.";

async function pickAndSetUnguarded(
  mutations: ProfilePhotoMutations,
): Promise<ProfilePhotoResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      status: "refused",
      reason: permission.canAskAgain
        ? "Frapp needs access to your photos to set one."
        : "Allow photo access for Frapp in Settings to set a photo.",
    };
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    allowsMultipleSelection: false,
  });
  if (picked.canceled) return { status: "cancelled" };
  const asset = picked.assets?.[0];
  if (!asset) return { status: "cancelled" };

  let uploadable: Awaited<ReturnType<typeof resolveUploadable>>;
  try {
    uploadable = await resolveUploadable(asset, "image");
  } catch {
    return { status: "refused", reason: PHOTO_TYPE_REFUSAL };
  }

  // The picker's size describes the picked file, so it is only trusted when
  // no transcode produced different bytes.
  const size = await byteSizeOf(
    uploadable.uri,
    uploadable.uri === asset.uri ? asset.fileSize : undefined,
  );
  const inspected = inspectUploadFile("image", {
    name: uploadable.filename,
    type: uploadable.contentType,
    size,
  });
  if (!inspected.ok) {
    return {
      status: "refused",
      reason: inspected.reason === "size" ? PHOTO_SIZE_REFUSAL : PHOTO_TYPE_REFUSAL,
    };
  }

  try {
    const ticket = await mutations.requestUploadUrl({
      filename: uploadable.filename,
      content_type: inspected.contentType,
      size_bytes: size,
    });
    const { signedUrl, storagePath } = readSignedUpload(ticket);
    const response = await FileSystem.uploadAsync(signedUrl, uploadable.uri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": inspected.contentType },
    });
    if (response.status < 200 || response.status >= 300) {
      return { status: "refused", reason: UPLOAD_FAILED };
    }
    await mutations.confirm(storagePath);
    return { status: "updated" };
  } catch (err) {
    return {
      status: "refused",
      reason:
        err instanceof Error && err.message.length > 0
          ? err.message
          : UPLOAD_FAILED,
    };
  }
}

/** See the module header. Never rejects. */
export async function pickAndSetProfilePhoto(
  mutations: ProfilePhotoMutations,
): Promise<ProfilePhotoResult> {
  try {
    return await pickAndSetUnguarded(mutations);
  } catch {
    return { status: "refused", reason: UPLOAD_FAILED };
  }
}
