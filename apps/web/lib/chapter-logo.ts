import type { ChapterLogoUpload } from "@repo/hooks";
import { MAX_UPLOAD_LABEL, inspectUploadFile } from "@repo/validation";

/**
 * The file check both logo pickers run (Settings → Chapter and the onboarding
 * wizard) before anything is uploaded, so a refused file never reaches the
 * mint and the two pickers can't disagree about what they accept.
 *
 * The allowlist and the cap are the shared `image` kind in `@repo/validation`,
 * the one the `branding` bucket enforces on the PUT; this restates neither.
 * The content type sent is the one the kind resolves from the extension, not
 * the browser's `file.type`, which can be empty.
 */
export function inspectLogoFile(
  file: File,
): { ok: true; upload: ChapterLogoUpload } | { ok: false; message: string } {
  const inspected = inspectUploadFile("image", file);
  if (!inspected.ok) {
    return {
      ok: false,
      message:
        inspected.reason === "size"
          ? `That file is too large. Logos can be up to ${MAX_UPLOAD_LABEL}.`
          : "Choose a JPEG, PNG, GIF or WebP image.",
    };
  }
  return {
    ok: true,
    upload: {
      body: file,
      filename: file.name,
      contentType: inspected.contentType,
    },
  };
}
