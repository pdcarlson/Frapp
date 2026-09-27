import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APP_STORE_PRESET,
  GOOGLE_PLAY_PRESET,
  STORE_SCALE,
  playSizeProblems,
  storePngProblems,
} from "../../demo/store-screenshots.mjs";

/**
 * A PNG as far as the chunk headers go: signature, IHDR, optional extra
 * chunks, IEND. No CRCs or pixels, because `storePngProblems` reads neither.
 */
function fakePng({ width, height, bitDepth = 8, colourType = 2, chunks = [] }) {
  const chunk = (type, data = Buffer.alloc(0)) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...chunks.map((type) => chunk(type, Buffer.alloc(6))),
    chunk("IDAT", Buffer.alloc(4)),
    chunk("IEND"),
  ]);
}

test("each preset's viewport at the store scale is its pixel size", () => {
  for (const preset of [APP_STORE_PRESET, GOOGLE_PLAY_PRESET]) {
    assert.deepEqual(
      {
        width: preset.viewport.width * STORE_SCALE,
        height: preset.viewport.height * STORE_SCALE,
      },
      preset.pixels,
      preset.name,
    );
  }
});

test("the Google Play preset is inside Play's screenshot limits", () => {
  assert.deepEqual(playSizeProblems(GOOGLE_PLAY_PRESET.pixels), []);
  assert.equal(GOOGLE_PLAY_PRESET.opaqueRgb, true, "Play rejects a PNG with alpha");
});

test("the App Store size breaks Play's 2:1 cap, which is why Play has its own preset", () => {
  assert.deepEqual(playSizeProblems(APP_STORE_PRESET.pixels), [
    "the long side is more than 2x the short side",
  ]);
});

test("playSizeProblems names each limit it breaks", () => {
  assert.deepEqual(playSizeProblems({ width: 1080, height: 2160 }), [], "exactly 2:1 is allowed");
  assert.deepEqual(playSizeProblems({ width: 300, height: 400 }), ["a side is under 320 px"]);
  assert.deepEqual(playSizeProblems({ width: 2000, height: 3900 }), ["a side is over 3840 px"]);
});

test("storePngProblems accepts an opaque 8-bit RGB PNG at the preset's size", () => {
  assert.deepEqual(
    storePngProblems(fakePng({ ...GOOGLE_PLAY_PRESET.pixels }), GOOGLE_PLAY_PRESET),
    [],
  );
});

test("storePngProblems refuses what Play would reject", () => {
  const size = GOOGLE_PLAY_PRESET.pixels;
  assert.deepEqual(storePngProblems(Buffer.alloc(64), GOOGLE_PLAY_PRESET), ["not a PNG"]);
  assert.deepEqual(
    storePngProblems(fakePng({ width: 1320, height: 2868 }), GOOGLE_PLAY_PRESET),
    ["1320x2868, expected 1242x2208"],
  );
  assert.deepEqual(
    storePngProblems(fakePng({ ...size, colourType: 6 }), GOOGLE_PLAY_PRESET),
    ["PNG colour type 6 at 8-bit, expected 8-bit RGB (colour type 2)"],
  );
  assert.deepEqual(
    storePngProblems(fakePng({ ...size, bitDepth: 16 }), GOOGLE_PLAY_PRESET),
    ["PNG colour type 2 at 16-bit, expected 8-bit RGB (colour type 2)"],
  );
  assert.deepEqual(
    storePngProblems(fakePng({ ...size, chunks: ["tRNS"] }), GOOGLE_PLAY_PRESET),
    ["PNG carries a tRNS transparency chunk"],
  );
});
