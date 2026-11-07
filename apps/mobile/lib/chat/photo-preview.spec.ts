import { ImageManipulator } from "expo-image-manipulator";
import { encode as encodeJpeg } from "jpeg-js";
import { thumbHashToApproximateAspectRatio } from "thumbhash";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_JPEG_QUALITY,
  PREVIEW_MAX_EDGE,
  describeChatPhoto,
} from "./photo-preview";

/**
 * The manipulator is native, so it is faked here: each `manipulate` answers
 * with a decoded image of the size the test sets, and a `saveAsync` asked for
 * base64 answers with a real tiny JPEG, so the ThumbHash is computed by the
 * real decoder and encoder.
 */
const manipulator = vi.mocked(ImageManipulator);

function tinyJpegBase64(width: number, height: number): string {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = 200; // a warm orange, so the hash is not all grey
    data[i * 4 + 1] = 120;
    data[i * 4 + 2] = 40;
    data[i * 4 + 3] = 255;
  }
  const encoded = encodeJpeg({ data, width, height }, 90);
  let binary = "";
  for (const byte of encoded.data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Resize = { width?: number; height?: number };

/** Fake one photo of `width` x `height`; records each resize and save. */
function photo(
  width: number,
  height: number,
  opts: { failRender?: boolean } = {},
) {
  const resizes: Resize[] = [];
  const saves: Record<string, unknown>[] = [];
  const release = vi.fn();
  manipulator.manipulate.mockImplementation((() => {
    let size = { width, height };
    const context = {
      resize: vi.fn((to: Resize) => {
        resizes.push(to);
        const scale = to.width
          ? to.width / size.width
          : to.height! / size.height;
        size = {
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
        };
        return context;
      }),
      renderAsync: vi.fn(async () => {
        if (opts.failRender) throw new Error("decode failed");
        const rendered = { ...size };
        return {
          width: rendered.width,
          height: rendered.height,
          release,
          saveAsync: vi.fn(async (options: Record<string, unknown>) => {
            saves.push(options);
            return options.base64
              ? {
                  uri: "file:///tiny.jpg",
                  base64: tinyJpegBase64(rendered.width, rendered.height),
                }
              : { uri: `file:///preview-${rendered.width}.jpg` };
          }),
        };
      }),
    };
    return context;
  }) as never);
  return { resizes, saves, release };
}

describe("describeChatPhoto", () => {
  beforeEach(() => {
    manipulator.manipulate.mockReset();
  });

  it("gives a large JPEG its upright size, a ThumbHash of its colours, and a 1280 px preview", async () => {
    const { resizes, saves } = photo(2560, 1920);

    const described = await describeChatPhoto(
      "file:///photo.jpg",
      "image/jpeg",
    );

    expect(described.width).toBe(2560);
    expect(described.height).toBe(1920);
    expect(described.previewUri).toBe(
      `file:///preview-${PREVIEW_MAX_EDGE}.jpg`,
    );
    expect(resizes).toContainEqual({ width: PREVIEW_MAX_EDGE });
    expect(saves).toContainEqual({
      format: "jpeg",
      compress: PREVIEW_JPEG_QUALITY,
    });

    expect(described.thumbhash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const bytes = Uint8Array.from(atob(described.thumbhash!), (c) =>
      c.charCodeAt(0),
    );
    expect(bytes.length).toBeLessThanOrEqual(25);
    // The hash keeps the photo's rough shape, which is what lets the blur fill the
    // same box the photo will.
    const ratio = thumbHashToApproximateAspectRatio(bytes);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.5);
  });

  it("releases every decoded image once it is done with it", async () => {
    const { release } = photo(2560, 1920);

    await describeChatPhoto("file:///photo.jpg", "image/jpeg");

    // The full-size decode, the preview and the ThumbHash source.
    expect(release).toHaveBeenCalledTimes(3);
  });

  it("fits a portrait photo by its height", async () => {
    const { resizes } = photo(1920, 2560);

    await describeChatPhoto("file:///photo.jpg", "image/jpeg");

    expect(resizes).toContainEqual({ height: PREVIEW_MAX_EDGE });
  });

  it("makes no preview for a photo already small enough to be its own", async () => {
    photo(1170, 900);

    const described = await describeChatPhoto(
      "file:///photo.jpg",
      "image/jpeg",
    );

    expect(described.previewUri).toBeNull();
    expect(described.width).toBe(1170);
    expect(described.thumbhash).not.toBeNull();
  });

  it.each(["image/png", "image/gif", "image/webp"])(
    "makes no JPEG preview of a %s, which may be transparent or animated, but still sizes it",
    async (type) => {
      photo(3000, 2000);

      const described = await describeChatPhoto("file:///pic", type);

      expect(described.previewUri).toBeNull();
      expect(described.width).toBe(3000);
      expect(described.thumbhash).not.toBeNull();
    },
  );

  it("describes nothing, and never throws, when the photo cannot be decoded", async () => {
    photo(2560, 1920, { failRender: true });

    await expect(
      describeChatPhoto("file:///photo.jpg", "image/jpeg"),
    ).resolves.toEqual({
      width: null,
      height: null,
      thumbhash: null,
      previewUri: null,
    });
  });

  it("describes nothing for a file that is not an image", async () => {
    const described = await describeChatPhoto(
      "file:///a.pdf",
      "application/pdf",
    );

    expect(described.previewUri).toBeNull();
    expect(manipulator.manipulate).not.toHaveBeenCalled();
  });
});
