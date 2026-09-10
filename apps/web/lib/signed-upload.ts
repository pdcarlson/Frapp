/**
 * Read the signed-upload ticket from POST …/upload-url.
 *
 * Wire names are snake_case (`upload_url`, `storage_path`), matching Discord
 * upload tickets and the confirm-upload DTOs. The Nest services return
 * camelCase internally; the controllers map. A camelCase-only 201 is what
 * staged as "Upload URL response missing signed URL or storage path."
 */
export const MISSING_SIGNED_UPLOAD =
  "Upload URL response missing signed URL or storage path.";

export function readSignedUpload(signed: unknown): {
  signedUrl: string;
  storagePath: string;
} {
  if (!signed || typeof signed !== "object") {
    throw new Error(MISSING_SIGNED_UPLOAD);
  }
  const rec = signed as Record<string, unknown>;
  const signedUrl =
    typeof rec.upload_url === "string" && rec.upload_url.length > 0
      ? rec.upload_url
      : null;
  const storagePath =
    typeof rec.storage_path === "string" && rec.storage_path.length > 0
      ? rec.storage_path
      : null;
  if (!signedUrl || !storagePath) {
    throw new Error(MISSING_SIGNED_UPLOAD);
  }
  return { signedUrl, storagePath };
}
