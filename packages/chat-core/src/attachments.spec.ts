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
    // No upload path accepts one, and it stays a download row if a row has it.
    "image/svg+xml",
    // Imported Discord media (the `archive` kind), which most browsers can't draw.
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
