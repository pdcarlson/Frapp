/**
 * Which chat attachments draw as an image, for both clients (#2874).
 *
 * An image attachment is shown inline and opens in the in-app viewer; every
 * other attachment is a file row that downloads. Both clients used to decide
 * this separately with `startsWith("image/")`, which also admitted types most
 * browsers can't draw (`image/tiff`, `image/heic`: imported Discord media,
 * which the `archive` kind accepts and live chat doesn't) and `image/svg+xml`,
 * which no upload path accepts but an older row could still carry. Those drew
 * as a broken image, and now fall to a file row. BMP and AVIF are
 * archive-only too, and stay images because browsers and both mobile
 * platforms draw them.
 *
 * This is a rendering choice, not the security boundary. The bucket gates the
 * declared type, never the bytes, so an attachment typed `image/png` may hold
 * anything. What keeps that harmless is that it is only ever drawn by an image
 * element, which never runs a response as a document, and that its signed URL
 * still forces a download everywhere else.
 * `spec/behavior/chat/README.md` § File and image uploads owns that rule.
 */
const VIEWABLE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

/**
 * True when an attachment's declared content type is a raster image both
 * clients can draw. A null type (the column is nullable) is a file row, and
 * so is a type with parameters this doesn't recognize the base of.
 */
export function isViewableImage(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return VIEWABLE_IMAGE_TYPES.has(base);
}
