import { describe, expect, it } from "vitest";
import { isViewableImage } from "./attachments";

describe("isViewableImage", () => {
  it.each([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
  ])("draws %s", (type) => {
    expect(isViewableImage(type)).toBe(true);
  });

  it("reads the base type, whatever its case or parameters", () => {
    expect(isViewableImage("IMAGE/PNG")).toBe(true);
    expect(isViewableImage("image/jpeg; charset=binary")).toBe(true);
  });

  it.each([
    // An imported row can carry one, and it stays a download row.
    "image/svg+xml",
    // On the `document` upload allowlist, but most browsers can't draw them.
    "image/tiff",
    "image/heic",
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
