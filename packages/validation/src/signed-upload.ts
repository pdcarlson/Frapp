/**
 * Read the signed-upload ticket from POST …/upload-url.
 *
 * Wire names are snake_case (`upload_url`, `storage_path`), matching Discord
 * upload tickets and the confirm-upload DTOs. The Nest services return
 * camelCase internally; the controllers map. A camelCase-only 201 is what
 * staged as "Upload URL response missing signed URL or storage path."
 *
 * This lives beside `upload-allowlists.ts` rather than in one app, and for the
 * same reason that file states in its own header: it is one half of the upload
 * contract, and a second copy of it drifts. It was `apps/web/lib/signed-upload.ts`
 * until mobile chat needed it too (#2464) — at which point copying would have
 * made a fifth reader of one wire shape across four web callers and a mobile
 * one. Every client reads the ticket here.
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
