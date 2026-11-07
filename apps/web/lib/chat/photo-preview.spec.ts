/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_JPEG_QUALITY,
  PREVIEW_MAX_EDGE,
  describeChatPhoto,
  thumbhashPlaceholderUrl,
} from "./photo-preview";

/**
 * jsdom has neither `createImageBitmap` nor a 2D canvas, so both are stood in
 * for here: a bitmap of the size a test sets, and a canvas context that hands
 * back flat orange pixels and a JPEG blob. The ThumbHash itself is computed by
 * the real library.
 */
function stubBrowser(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close })),
  );
  const canvases: { width: number; height: number; quality?: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function () {
      return {
        drawImage: vi.fn(),
        imageSmoothingQuality: "low",
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i += 1)
            data.set([200, 120, 40, 255], i * 4);
          return { data, width: w, height: h };
        },
      } as unknown as CanvasRenderingContext2D;
    } as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    _type?: string,
    quality?: number,
  ) {
    canvases.push({ width: this.width, height: this.height, quality });
    callback(new Blob(["jpeg"], { type: "image/jpeg" }));
  });
  return { close, canvases };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file = new Blob(["x"], { type: "image/jpeg" });

describe("describeChatPhoto", () => {
  it("gives a large JPEG its size, a ThumbHash and a 1280 px JPEG preview", async () => {
    const { close, canvases } = stubBrowser(4032, 3024);

    const described = await describeChatPhoto(file, "image/jpeg");

    expect(described.width).toBe(4032);
    expect(described.height).toBe(3024);
    expect(described.thumbhash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(described.preview).toBeInstanceOf(Blob);
    expect(canvases).toEqual([
      { width: PREVIEW_MAX_EDGE, height: 960, quality: PREVIEW_JPEG_QUALITY },
    ]);
    // The decoded bitmap is released, not left for the collector.
    expect(close).toHaveBeenCalled();
  });

  it("makes no preview for a photo already small enough", async () => {
    stubBrowser(1200, 900);

    const described = await describeChatPhoto(file, "image/jpeg");

    expect(described.preview).toBeNull();
    expect(described.thumbhash).not.toBeNull();
  });

  it.each(["image/png", "image/gif", "image/webp"])(
    "makes no JPEG preview of a %s, which may be transparent or animated",
    async (type) => {
      stubBrowser(3000, 2000);

      const described = await describeChatPhoto(file, type);

      expect(described.preview).toBeNull();
      expect(described.width).toBe(3000);
    },
  );

  it("describes nothing where the browser cannot decode images", async () => {
    await expect(describeChatPhoto(file, "image/jpeg")).resolves.toEqual({
      width: null,
      height: null,
      thumbhash: null,
      preview: null,
    });
  });

  it("describes nothing, and never throws, for a file that will not decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("not an image");
      }),
    );

    await expect(describeChatPhoto(file, "image/jpeg")).resolves.toMatchObject({
      width: null,
      preview: null,
    });
  });

  it("never decodes an SVG or a document", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);

    await describeChatPhoto(file, "image/svg+xml");
    await describeChatPhoto(file, "application/pdf");

    expect(decode).not.toHaveBeenCalled();
  });
});

describe("thumbhashPlaceholderUrl", () => {
  it("draws a hash as a PNG data URL", () => {
    expect(thumbhashPlaceholderUrl("3OcRJYB4d3h/iIeHeEh3eIhw+j3A")).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("answers null for no hash or a malformed one", () => {
    expect(thumbhashPlaceholderUrl(null)).toBeNull();
    expect(thumbhashPlaceholderUrl("!!not base64!!")).toBeNull();
  });
});
