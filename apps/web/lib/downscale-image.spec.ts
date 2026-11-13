// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downscaleImage, withExtension } from "./downscale-image";

/**
 * #2912: a profile photo or logo is stored at 512px on its longest edge. jsdom
 * has neither `createImageBitmap` nor a canvas that encodes, so both are
 * stubbed: what these pin is the decision (keep, shrink, which type) and the
 * fallbacks, not the browser's resampling.
 */

let encodes: string[];
let encodedType: (requested: string) => string;
let drawn: { width: number; height: number } | null;

function stubBitmap(width: number, height: number) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width, height, close: vi.fn() }),
  );
}

beforeEach(() => {
  encodes = [];
  encodedType = (requested) => requested;
  drawn = null;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      const { width, height } = this;
      return {
        fillRect: vi.fn(),
        drawImage: vi.fn(() => {
          drawn = { width, height };
        }),
      } as never;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type) => {
      encodes.push(type ?? "");
      callback(new Blob(["x".repeat(10)], { type: encodedType(type ?? "") }));
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const big = (type: string, name: string) => ({
  body: new Blob(["x".repeat(4 * 1024 * 1024)], { type }),
  filename: name,
  contentType: type,
});

describe("downscaleImage", () => {
  it("shrinks a phone photo to 512 on its long edge, as JPEG", async () => {
    stubBitmap(3024, 4032);

    const out = await downscaleImage(big("image/png", "me.png"), {
      keepAlpha: false,
    });

    expect(drawn).toEqual({ width: 384, height: 512 });
    expect(out.contentType).toBe("image/jpeg");
    expect(out.filename).toBe("me.jpg");
    expect(out.body.size).toBe(10);
  });

  it("keeps a logo's transparency as WebP", async () => {
    stubBitmap(2000, 2000);

    const out = await downscaleImage(big("image/png", "crest.png"), {
      keepAlpha: true,
    });

    expect(out.contentType).toBe("image/webp");
    expect(out.filename).toBe("crest.webp");
  });

  it("falls back to PNG where the browser can't encode WebP", async () => {
    stubBitmap(2000, 2000);
    encodedType = () => "image/png";

    const out = await downscaleImage(big("image/png", "crest.png"), {
      keepAlpha: true,
    });

    expect(encodes).toEqual(["image/webp", "image/png"]);
    expect(out.contentType).toBe("image/png");
  });

  it("flattens a GIF even when it is already small in pixels", async () => {
    stubBitmap(200, 200);

    const out = await downscaleImage(
      {
        body: new Blob(["gif"], { type: "image/gif" }),
        filename: "wave.gif",
        contentType: "image/gif",
      },
      { keepAlpha: true },
    );

    expect(out.contentType).toBe("image/webp");
    expect(drawn).toEqual({ width: 200, height: 200 });
  });

  it("uploads a small image within the bound as it is", async () => {
    stubBitmap(400, 400);
    const small = {
      body: new Blob(["png"], { type: "image/png" }),
      filename: "crest.png",
      contentType: "image/png",
    };

    await expect(downscaleImage(small, { keepAlpha: true })).resolves.toBe(
      small,
    );
    expect(encodes).toEqual([]);
  });

  it("uploads the original when the browser can't decode it", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("decode")),
    );
    const original = big("image/jpeg", "me.jpg");

    await expect(downscaleImage(original, { keepAlpha: false })).resolves.toBe(
      original,
    );
  });
});

describe("withExtension", () => {
  it("swaps or adds the extension", () => {
    expect(withExtension("me.photo.png", "jpg")).toBe("me.photo.jpg");
    expect(withExtension("crest", "webp")).toBe("crest.webp");
    expect(withExtension(".png", "jpg")).toBe("image.jpg");
  });
});
