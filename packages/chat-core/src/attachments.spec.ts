import { describe, expect, it } from "vitest";
import { isAllowedUploadMime } from "@repo/validation";
import { isViewableImage, viewableImageExtension } from "./attachments";

describe("isViewableImage", () => {
  it.each(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"])(
    "draws %s",
    (type) => {
      expect(isViewableImage(type)).toBe(true);
    },
  );

  it("reads the base type, whatever its case or parameters", () => {
    expect(isViewableImage("IMAGE/PNG")).toBe(true);
    expect(isViewableImage("image/jpeg; charset=binary")).toBe(true);
  });

  it.each([
    // No upload path accepts one, and it stays a download row if a row has it.
    "image/svg+xml",
    // Imported Discord media (the `archive` kind), which most browsers can't draw.
    "image/tiff",
    "image/heic",
    // Archive-only, and Android decodes it only from Android 12.
    "image/avif",
    "application/pdf",
    "text/html",
    "",
  ])("keeps %s a file row", (type) => {
    expect(isViewableImage(type)).toBe(false);
  });

  it("keeps a null type a file row, since the column is nullable", () => {
    expect(isViewableImage(null)).toBe(false);
  });
});

describe("viewableImageExtension", () => {
  it("follows the declared type, whatever its case or parameters", () => {
    expect(viewableImageExtension("image/jpeg")).toBe("jpg");
    expect(viewableImageExtension("IMAGE/PNG; charset=binary")).toBe("png");
  });

  it("has none for a type that isn't a viewable image", () => {
    expect(viewableImageExtension("text/html")).toBeNull();
    expect(viewableImageExtension("image/svg+xml")).toBeNull();
    expect(viewableImageExtension(null)).toBeNull();
  });
});

// The API stamps every `image/` attachment of a send as a photo
// (`attachmentMetadataOf`, #3879), and readers reserve a photo's box for it
// while the attachments read is out. That only holds while every image live
// chat accepts is one the clients draw inline: an image type added to
// `document` that they don't would reserve a photo box, then draw a file row.
describe("live chat's image uploads", () => {
  it("are all images the clients draw inline", () => {
    // Every image type a phone or browser might hand the composer.
    const images = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/tiff",
      "image/avif",
      "image/heic",
      "image/heif",
      "image/jxl",
      "image/svg+xml",
      "image/x-icon",
    ].filter((mime) => isAllowedUploadMime("document", mime));
    expect(images.length).toBeGreaterThan(0);
    for (const mime of images) expect(isViewableImage(mime)).toBe(true);
  });
});
