import { rgbaToThumbHash, thumbHashToDataURL } from "thumbhash";

/**
 * What a reader needs to draw a chat photo before the photo itself arrives
 * (2026-11-07, `spec/behavior/chat/README.md` § Photo previews): its size, a
 * ThumbHash for the blur that fills its shape while it loads, and a preview
 * copy {@link PREVIEW_MAX_EDGE} on its longest edge for the timeline to
 * download instead of the original.
 *
 * The web half of `apps/mobile/lib/chat/photo-preview.ts`, with the same
 * numbers and the same rule on which photos get a preview copy, so a photo
 * reads the same whichever app sent it. Made in the browser from the file
 * being uploaded; every step is best effort, and a photo that cannot be
 * described is still sent and drawn as it always was.
 */

/** The longest edge of the copy the timeline draws (mobile's number). */
export const PREVIEW_MAX_EDGE = 1280;

/** JPEG quality of that copy (mobile's number). */
export const PREVIEW_JPEG_QUALITY = 0.7;

/** ThumbHash takes at most 100 px a side; a few dozen is plenty. */
const THUMBHASH_SOURCE_EDGE = 32;

export interface PhotoDescription {
  width: number | null;
  height: number | null;
  thumbhash: string | null;
  /** The preview JPEG to upload, or null when none is worth it. */
  preview: Blob | null;
}

const NOTHING: PhotoDescription = {
  width: null,
  height: null,
  thumbhash: null,
  preview: null,
};

/**
 * Describe `file`, about to be uploaded as `contentType`. Never throws.
 *
 * Only a JPEG gets a preview copy: a GIF's would be its first frame, and a
 * PNG or WebP may be transparent, which a JPEG would fill in black. Both still
 * get a size and a ThumbHash.
 */
export async function describeChatPhoto(
  file: Blob,
  contentType: string,
): Promise<PhotoDescription> {
  if (
    !contentType.startsWith("image/") ||
    contentType === "image/svg+xml" ||
    typeof createImageBitmap !== "function"
  ) {
    return NOTHING;
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF orientation, so the size is the upright
    // one a reader draws.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return NOTHING;
  }
  try {
    const width = bitmap.width > 0 ? bitmap.width : null;
    const height = bitmap.height > 0 ? bitmap.height : null;
    if (!width || !height) return NOTHING;
    const [thumbhash, preview] = await Promise.all([
      Promise.resolve().then(() => thumbhashOf(bitmap, width, height)),
      contentType === "image/jpeg" && Math.max(width, height) > PREVIEW_MAX_EDGE
        ? previewOf(bitmap, width, height)
        : null,
    ]);
    return { width, height, thumbhash, preview };
  } finally {
    bitmap.close();
  }
}

function fitted(
  width: number,
  height: number,
  edge: number,
): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function thumbhashOf(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): string | null {
  try {
    const size = fitted(width, height, THUMBHASH_SOURCE_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const pixels = context.getImageData(0, 0, size.width, size.height);
    return bytesToBase64(rgbaToThumbHash(size.width, size.height, pixels.data));
  } catch {
    return null;
  }
}

async function previewOf(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob | null> {
  try {
    const size = fitted(width, height, PREVIEW_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PREVIEW_JPEG_QUALITY),
    );
  } catch {
    return null;
  }
}

/**
 * The blurred placeholder for a ThumbHash as a `data:image/png` URL, or null
 * for a missing or malformed hash, so a bad one costs only the blur.
 */
export function thumbhashPlaceholderUrl(
  thumbhash: string | null | undefined,
): string | null {
  if (!thumbhash) return null;
  const cached = placeholders.get(thumbhash);
  if (cached !== undefined) return cached;
  let url: string | null;
  try {
    const binary = atob(thumbhash);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    url = thumbHashToDataURL(bytes);
  } catch {
    url = null;
  }
  // Every render of every photo asks; the decode and PNG encode run once per
  // hash instead (mobile keeps the same cache).
  if (placeholders.size >= PLACEHOLDER_CACHE_SIZE) {
    const oldest = placeholders.keys().next().value;
    if (oldest !== undefined) placeholders.delete(oldest);
  }
  placeholders.set(thumbhash, url);
  return url;
}

const PLACEHOLDER_CACHE_SIZE = 200;
const placeholders = new Map<string, string | null>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
