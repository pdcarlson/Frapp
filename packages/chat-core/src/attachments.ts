/**
 * Which chat attachments draw as an image, for both clients (#2874).
 *
 * An image attachment is shown inline and opens in the in-app viewer; every
 * other attachment is a file row that downloads. Both clients used to decide
 * this separately with `startsWith("image/")`, which also admitted types that
 * some supported platform can't draw: `image/tiff` and `image/heic` (imported
 * Discord media, which the `archive` kind accepts and live chat doesn't),
 * `image/avif` (archive-only too; Android decodes it only from Android 12,
 * and the app supports Android 7), and `image/svg+xml`, which no upload path
 * accepts but an older row could still carry. Those drew as a blank or broken
 * image, and now fall to a file row.
 *
 * This is a rendering choice, not the security boundary. The bucket gates the
 * declared type, never the bytes, so an attachment typed `image/png` may hold
 * anything. What keeps that harmless is that it is only ever drawn by an image
 * element, which never runs a response as a document, and that its signed URL
 * still forces a download everywhere else.
 * `spec/behavior/chat/README.md` § File and image uploads owns that rule.
 */
const VIEWABLE_IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/bmp", "bmp"],
]);

function baseType(contentType: string | null): string | null {
  if (!contentType) return null;
  return contentType.split(";")[0]!.trim().toLowerCase();
}

/**
 * True when an attachment's declared content type is a raster image both
 * clients can draw. A null type (the column is nullable) is a file row, and
 * so is a type with parameters this doesn't recognize the base of.
 */
export function isViewableImage(contentType: string | null): boolean {
  const base = baseType(contentType);
  return base !== null && VIEWABLE_IMAGE_EXTENSIONS.has(base);
}

/**
 * The file extension for a viewable image's declared type, or `null` for any
 * other type. Mobile names the file it saves or shares with this rather than
 * with the sender's filename, which the API stores unvalidated: a file
 * handed to another app is typed by its extension, so the extension must
 * follow the type the viewer drew, not a name the sender chose.
 */
export function viewableImageExtension(
  contentType: string | null,
): string | null {
  const base = baseType(contentType);
  return (base !== null && VIEWABLE_IMAGE_EXTENSIONS.get(base)) || null;
}
