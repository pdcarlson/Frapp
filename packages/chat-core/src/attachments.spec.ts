import { describe, expect, it } from "vitest";
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
