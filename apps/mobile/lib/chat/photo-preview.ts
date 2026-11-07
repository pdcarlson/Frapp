import {
  ImageManipulator,
  SaveFormat,
  type ImageRef,
} from "expo-image-manipulator";
import { decode as decodeJpeg } from "jpeg-js";
import { rgbaToThumbHash, thumbHashToDataURL } from "thumbhash";

/**
 * What a reader needs to draw a chat photo before the photo itself arrives
 * (2026-11-07, `spec/behavior/chat/README.md` § Photo previews).
 *
 * - **Its size**, so the bubble is drawn at the photo's shape at once and
 *   nothing below it jumps when it loads.
 * - **A ThumbHash**, about 25 bytes, which the reader turns into a soft blur
 *   of the photo's colours to fill that shape while it downloads.
 * - **A preview copy**, {@link PREVIEW_MAX_EDGE} on its longest edge, which
 *   is what the timeline downloads. A phone's photo is uploaded at 2560 px
 *   (`PHOTO_MAX_EDGE`), several hundred KB; a bubble is at most about 300
 *   points wide, so the preview is a fifth of the bytes and looks the same.
 *   The original still opens full screen.
 *
 * All three are made on the sender's phone, from the bytes about to be
 * uploaded, so the API never decodes an image. Each step is best effort: a
 * photo whose preview cannot be made is still sent, and readers draw the
 * original as they always have.
 */

/** The longest edge of the copy the timeline draws. */
export const PREVIEW_MAX_EDGE = 1280;

/** JPEG quality of that copy: at bubble size the difference does not show. */
export const PREVIEW_JPEG_QUALITY = 0.7;

/**
 * The edge of the tiny image a ThumbHash is computed from. ThumbHash takes at
 * most 100 px a side and keeps only a few low frequencies, so anything above
 * a few dozen pixels only costs decode time.
 */
const THUMBHASH_SOURCE_EDGE = 32;

export interface PhotoDescription {
  width: number | null;
  height: number | null;
  thumbhash: string | null;
  /** A local JPEG to upload as the preview, or null when none is worth it. */
  previewUri: string | null;
}

const NOTHING: PhotoDescription = {
  width: null,
  height: null,
  thumbhash: null,
  previewUri: null,
};

/**
 * Describe the photo at `uri`, the bytes about to be uploaded as
 * `contentType`. Never throws: whatever could not be made comes back null.
 *
 * Only a JPEG gets a preview copy. A GIF's preview would be its first frame,
 * and the timeline is where it animates; a PNG or WebP may be transparent,
 * which a JPEG would fill in black. Both still get a size and a ThumbHash.
 */
export async function describeChatPhoto(
  uri: string,
  contentType: string,
): Promise<PhotoDescription> {
  if (!contentType.startsWith("image/")) return NOTHING;

  let source: ImageRef;
  try {
    // Rendered once and reused: the decoded image is upright (EXIF applied),
    // so its size is the one a reader draws, which the picker's own numbers
    // are not always on Android.
    source = await ImageManipulator.manipulate(uri).renderAsync();
  } catch {
    return NOTHING;
  }
  const width = source.width > 0 ? Math.round(source.width) : null;
  const height = source.height > 0 ? Math.round(source.height) : null;

  const [thumbhash, previewUri] = await Promise.all([
    thumbhashOf(source, width, height),
    contentType === "image/jpeg" ? previewOf(source, width, height) : null,
  ]);
  return { width, height, thumbhash, previewUri };
}

/** Scale `width` x `height` so the longest edge is at most `edge`. */
function fit(
  width: number,
  height: number,
  edge: number,
): { width: number } | { height: number } {
  return width >= height
    ? { width: Math.min(edge, width) }
    : { height: Math.min(edge, height) };
}

async function previewOf(
  source: ImageRef,
  width: number | null,
  height: number | null,
): Promise<string | null> {
  // A photo already this small is its own preview; a copy would only add a
  // second upload of the same pixels.
  if (!width || !height || Math.max(width, height) <= PREVIEW_MAX_EDGE) {
    return null;
  }
  try {
    const rendered = await ImageManipulator.manipulate(source)
      .resize(fit(width, height, PREVIEW_MAX_EDGE))
      .renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: PREVIEW_JPEG_QUALITY,
    });
    return saved.uri;
  } catch {
    return null;
  }
}

async function thumbhashOf(
  source: ImageRef,
  width: number | null,
  height: number | null,
): Promise<string | null> {
  if (!width || !height) return null;
  try {
    const rendered = await ImageManipulator.manipulate(source)
      .resize(fit(width, height, THUMBHASH_SOURCE_EDGE))
      .renderAsync();
    // A tiny JPEG, decoded here in JS: the manipulator hands back files, not
    // pixels, and a JPEG decoder is the smallest pure-JS way to get them.
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.9,
      base64: true,
    });
    if (!saved.base64) return null;
    const pixels = decodeJpeg(base64ToBytes(saved.base64), {
      useTArray: true,
      formatAsRGBA: true,
    });
    if (
      pixels.width < 1 ||
      pixels.height < 1 ||
      pixels.width > 100 ||
      pixels.height > 100
    ) {
      return null;
    }
    return bytesToBase64(
      rgbaToThumbHash(pixels.width, pixels.height, pixels.data),
    );
  } catch {
    return null;
  }
}

/**
 * The blurred placeholder for a ThumbHash, as a `data:image/png` URI an
 * `<Image>` draws. Null for a missing or malformed hash, so a bad one costs
 * only the placeholder.
 */
export function thumbhashPlaceholderUri(
  thumbhash: string | null | undefined,
): string | null {
  if (!thumbhash) return null;
  try {
    return thumbHashToDataURL(base64ToBytes(thumbhash));
  } catch {
    return null;
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
