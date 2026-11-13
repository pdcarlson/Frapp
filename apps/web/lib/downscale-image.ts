import { AVATAR_MAX_EDGE } from "@repo/validation";

/** An image ready to PUT: the bytes, its name and the type to declare. */
export interface PreparedImage {
  body: Blob;
  filename: string;
  contentType: string;
}

/**
 * Below this many bytes, an image already within {@link AVATAR_MAX_EDGE} is
 * uploaded as it is: re-encoding a small PNG logo would only cost it quality.
 */
const KEEP_AS_IS_BYTES = 256 * 1024;

/** JPEG quality for a downscaled photo: no visible loss at 512px. */
const QUALITY = 0.85;

/**
 * Shrink a profile photo or chapter logo to {@link AVATAR_MAX_EDGE} on its
 * longest side before it is uploaded (#2912).
 *
 * The stored object is what every avatar and crest downloads, at 24-112px, so a
 * 4 MB phone photo stored as picked made a 25-member directory cost 100 MB.
 *
 * - A GIF is always re-encoded, which keeps its first frame: an animated avatar
 *   was unbounded in bytes, and no surface animates one.
 * - `keepAlpha` (logos) encodes PNG, which keeps transparency. Not WebP: the
 *   PDF report embeds the logo, and its renderer reads only PNG and JPEG. A
 *   photo encodes JPEG over white, the smallest for a photograph; every
 *   surface draws it in a filled circle.
 * - The original is kept when it is already within the bound and small, or
 *   when the re-encode would not be smaller.
 * - A file the browser can't decode is uploaded as it is, so a downscale that
 *   fails never blocks an upload the type gate already accepted.
 */
export async function downscaleImage(
  image: PreparedImage,
  { keepAlpha }: { keepAlpha: boolean },
): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    // Explicit, as in `chat/photo-preview.ts`: the bound applies upright.
    bitmap = await createImageBitmap(image.body, {
      imageOrientation: "from-image",
    });
  } catch {
    return image;
  }
  try {
    const edge = Math.max(bitmap.width, bitmap.height);
    if (
      edge <= AVATAR_MAX_EDGE &&
      image.contentType !== "image/gif" &&
      image.body.size <= KEEP_AS_IS_BYTES
    ) {
      return image;
    }
    const scale = Math.min(1, AVATAR_MAX_EDGE / edge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return image;
    if (!keepAlpha) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);

    const type = keepAlpha ? "image/png" : "image/jpeg";
    const blob = await toBlob(canvas, type);
    if (!blob || blob.type !== type) return image;
    // Never trade a small original for a larger re-encode.
    if (blob.size >= image.body.size && image.contentType !== "image/gif") {
      return image;
    }
    return {
      body: blob,
      filename: withExtension(image.filename, extensionFor(blob.type)),
      contentType: blob.type,
    };
  } finally {
    bitmap.close();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, QUALITY);
  });
}

function extensionFor(type: string): string {
  if (type === "image/png") return "png";
  return "jpg";
}

/** `name` with its extension swapped for `extension`, or added when it has none. */
export function withExtension(name: string, extension: string): string {
  const base = name.replace(/\.[^./]*$/, "");
  return `${base.length > 0 ? base : "image"}.${extension}`;
}
