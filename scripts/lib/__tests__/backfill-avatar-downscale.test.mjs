import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import {
  AVATAR_MAX_EDGE,
  shrinkImage,
} from "../../backfill-avatar-downscale.mjs";

// #2912's backfill: what it rewrites, what it leaves, and that the format
// survives (the stored path's extension must stay true).

const noise = (width, height, channels = 3) =>
  sharp(
    Buffer.from(
      Array.from({ length: width * height * channels }, () =>
        Math.floor(Math.random() * 256),
      ),
    ),
    { raw: { width, height, channels } },
  );

test("shrinks a large JPEG to the bound, still JPEG", async () => {
  const input = await noise(2000, 1500).jpeg({ quality: 95 }).toBuffer();
  const output = await shrinkImage(input);
  assert.ok(output);
  const meta = await sharp(output).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, AVATAR_MAX_EDGE);
  assert.equal(meta.height, 384);
  assert.ok(output.length < input.length);
});

test("keeps a PNG's alpha", async () => {
  const input = await noise(1200, 1200, 4).png().toBuffer();
  const output = await shrinkImage(input);
  assert.ok(output);
  const meta = await sharp(output).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.hasAlpha, true);
  assert.equal(meta.width, AVATAR_MAX_EDGE);
});

test("leaves a small image within the bound alone", async () => {
  const input = await noise(200, 200).jpeg().toBuffer();
  assert.equal(await shrinkImage(input), null);
});

test("leaves bytes it can't decode alone", async () => {
  assert.equal(await shrinkImage(Buffer.from("not an image")), null);
});

test("flattens an animated GIF to its first frame, still GIF", async () => {
  // Three 100x100 pages: animated, so it is rewritten though small.
  const frame = 100;
  const animated = await sharp(
    await noise(frame, frame * 3)
      .raw()
      .toBuffer(),
    {
      raw: { width: frame, height: frame * 3, channels: 3, pageHeight: frame },
    },
  )
    .gif()
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 3);

  const output = await shrinkImage(animated);
  assert.ok(output);
  const meta = await sharp(output, { pages: -1 }).metadata();
  assert.equal(meta.format, "gif");
  assert.equal(meta.pages ?? 1, 1);
  assert.equal(meta.height, frame);
});

test("leaves an object whose re-encode would not be smaller", async () => {
  // A flat 600px palette PNG of a few hundred bytes: past the bound, but the
  // 512px RGB re-encode is larger, so the object is left as it is.
  const input = await sharp({
    create: { width: 600, height: 600, channels: 3, background: "#336699" },
  })
    .png({ palette: true })
    .toBuffer();
  assert.equal(await shrinkImage(input), null);
});
