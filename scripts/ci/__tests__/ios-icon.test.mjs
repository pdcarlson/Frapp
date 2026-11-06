// The iOS app icon (`scripts/lib/ios-icon.mjs`): dark is `icon.png`, light is
// `icon-light.png`, ink on cream, and tinted is `icon-tinted.png`, grey on black.
//
// `check:brand-assets` (section 6) audits the committed light and tinted files'
// pixels with `assertLightIcon` and `assertTintedIcon`. This holds what it can't see: that `app.json` names
// these files, and that the transform and the audit say what the module says
// they do. Like `brand-pixels.test.mjs`, this imports nothing that needs
// `npm ci`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IOS_ICON,
  IOS_ICON_LIGHT,
  IOS_ICON_SIZE,
  IOS_ICON_TINTED,
  LIGHT_FIELD_HEX,
  assertLightIcon,
  assertTintedIcon,
  iosIconConfig,
  lightFromGlyph,
  lightMask,
  tintedFromGlyph,
  tintedMask,
} from "../../lib/ios-icon.mjs";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const repo = (rel) => join(REPO_ROOT, rel);

/** A grey square `size` wide with a lit block in the middle covering `share` of it. */
function tintedSquare(size, share) {
  const data = Buffer.alloc(size * size * 3);
  const side = Math.round(size * Math.sqrt(share));
  const start = Math.floor((size - side) / 2);
  for (let y = start; y < start + side; y += 1) {
    for (let x = start; x < start + side; x += 1) {
      data.fill(255, (y * size + x) * 3, (y * size + x) * 3 + 3);
    }
  }
  return data;
}

test("app.json names the PNGs per appearance on ios.icon", () => {
  const appJson = JSON.parse(
    readFileSync(repo("apps/mobile/app.json"), "utf8"),
  );
  assert.deepEqual(appJson.expo.ios.icon, iosIconConfig());
  assert.deepEqual(iosIconConfig(), {
    light: "./assets/images/icon-light.png",
    dark: "./assets/images/icon.png",
    tinted: "./assets/images/icon-tinted.png",
  });
  // Dark is the tile every other surface ships, so the field and the gold
  // reach iOS exactly as they reach Android and the web.
  assert.equal(appJson.expo.icon, iosIconConfig().dark);
  for (const rel of new Set(Object.values(IOS_ICON))) {
    assert.ok(existsSync(repo(rel)), `${rel} must be committed`);
  }
});

test("no Icon Composer bundle is left for prebuild to find", () => {
  // `actool` died on one in the first iOS store build (#3319). A `.icon`
  // anywhere in `ios.icon` or the top-level `icon` reaches prebuild again.
  const appJson = readFileSync(repo("apps/mobile/app.json"), "utf8");
  assert.ok(!appJson.includes(".icon\""), "app.json must not name a .icon bundle");
  assert.ok(!existsSync(repo("apps/mobile/assets/frapp.icon")));
});

test("tintedFromGlyph turns the crest's alpha into grey, whatever its colour", () => {
  // Gold at full alpha, gold at half alpha, a transparent pixel still carrying
  // gold bytes, and white at full alpha.
  const rgba = Buffer.from([
    0xdd, 0xb8, 0x44, 255,
    0xdd, 0xb8, 0x44, 128,
    0xdd, 0xb8, 0x44, 0,
    255, 255, 255, 255,
  ]);
  assert.deepEqual(
    [...tintedFromGlyph(rgba, 4)],
    [255, 255, 255, 128, 128, 128, 0, 0, 0, 255, 255, 255],
  );
  assert.throws(() => tintedFromGlyph(Buffer.alloc(3), 3), /needs an RGBA render/);
});

test("assertTintedIcon accepts grey on black with a crest in the glyph band", () => {
  assert.doesNotThrow(() =>
    assertTintedIcon(tintedSquare(IOS_ICON_SIZE, 0.3), 3, IOS_ICON_SIZE, IOS_ICON_SIZE, "ok"),
  );
});

test("assertTintedIcon refuses another size, alpha, colour, a lit corner, and an empty or solid icon", () => {
  const n = IOS_ICON_SIZE;
  assert.throws(
    () => assertTintedIcon(tintedSquare(512, 0.3), 3, 512, 512, "small"),
    /is 512x512; it must be 1024x1024/,
  );
  // Prebuild would flatten the transparency onto white.
  assert.throws(
    () => assertTintedIcon(Buffer.alloc(n * n * 4), 4, n, n, "rgba"),
    /has 4 channels; it must be opaque RGB/,
  );
  const coloured = tintedSquare(n, 0.3);
  coloured[(512 * n + 512) * 3 + 2] = 0;
  assert.throws(
    () => assertTintedIcon(coloured, 3, n, n, "coloured"),
    /pixel \(512, 512\) is not grey/,
  );
  const corner = tintedSquare(n, 0.3);
  corner.fill(255, (n * n - 1) * 3, n * n * 3);
  assert.throws(
    () => assertTintedIcon(corner, 3, n, n, "corner"),
    /corner \(1023, 1023\) is not black/,
  );
  assert.throws(
    () => assertTintedIcon(Buffer.alloc(n * n * 3), 3, n, n, "empty"),
    /covers 0\.00% of the layer/,
  );
  assert.throws(
    () => assertTintedIcon(tintedSquare(n, 0.9), 3, n, n, "solid"),
    /outside the 4-60% band/,
  );
});

test("tintedMask marks the pixels past half grey", () => {
  const data = Buffer.from([0, 0, 0, 127, 127, 127, 128, 128, 128, 255, 255, 255]);
  assert.deepEqual([...tintedMask(data, 4, 1)], [0, 0, 1, 1]);
  assert.equal(IOS_ICON_TINTED, IOS_ICON.tinted);
});

/** A light icon `size` wide: the crest at full alpha in a middle block covering `share`, cream elsewhere. */
function lightSquare(size, share) {
  const rgba = Buffer.alloc(size * size * 4);
  const side = Math.round(size * Math.sqrt(share));
  const start = Math.floor((size - side) / 2);
  for (let y = start; y < start + side; y += 1) {
    for (let x = start; x < start + side; x += 1) {
      rgba[(y * size + x) * 4 + 3] = 255;
    }
  }
  return lightFromGlyph(rgba, 4);
}

test("lightFromGlyph moves each pixel from cream to ink by the crest's alpha", () => {
  const rgba = Buffer.from([
    0xdd, 0xb8, 0x44, 0,
    0xdd, 0xb8, 0x44, 255,
    0xdd, 0xb8, 0x44, 128,
  ]);
  const cream = [0xf4, 0xef, 0xe4];
  const ink = [0x1a, 0x1a, 0x1a];
  const half = cream.map((c, i) => Math.round((c * 127 + ink[i] * 128) / 255));
  assert.equal(LIGHT_FIELD_HEX, "#F4EFE4");
  assert.deepEqual([...lightFromGlyph(rgba, 4)], [...cream, ...ink, ...half]);
  assert.throws(() => lightFromGlyph(Buffer.alloc(3), 3), /needs an RGBA render/);
});

test("assertLightIcon accepts ink on cream with a crest in the glyph band", () => {
  assert.doesNotThrow(() =>
    assertLightIcon(lightSquare(IOS_ICON_SIZE, 0.3), 3, IOS_ICON_SIZE, IOS_ICON_SIZE, "ok"),
  );
});

test("assertLightIcon refuses another size, alpha, an off-line colour, a dark corner, and an empty or solid icon", () => {
  const n = IOS_ICON_SIZE;
  assert.throws(
    () => assertLightIcon(lightSquare(512, 0.3), 3, 512, 512, "small"),
    /is 512x512; it must be 1024x1024/,
  );
  // Prebuild would flatten the transparency onto white and lose the cream.
  assert.throws(
    () => assertLightIcon(Buffer.alloc(n * n * 4), 4, n, n, "rgba"),
    /has 4 channels; it must be opaque RGB/,
  );
  // The old light icon: gold on the dark field is off the cream-to-ink line.
  const gold = lightSquare(n, 0.3);
  gold.set([0xdd, 0xb8, 0x44], (512 * n + 512) * 3);
  assert.throws(() => assertLightIcon(gold, 3, n, n, "gold"), /pixel \(512, 512\) is off the/);
  const corner = lightSquare(n, 0.3);
  corner.fill(0x1a, (n * n - 1) * 3, n * n * 3);
  assert.throws(
    () => assertLightIcon(corner, 3, n, n, "corner"),
    /corner \(1023, 1023\) is not #F4EFE4/,
  );
  assert.throws(
    () => assertLightIcon(lightSquare(n, 0), 3, n, n, "empty"),
    /covers 0\.00% of the layer/,
  );
  assert.throws(
    () => assertLightIcon(lightSquare(n, 0.9), 3, n, n, "solid"),
    /outside the 4-60% band/,
  );
});

test("lightMask marks the pixels past halfway to ink", () => {
  // Not 127 and 128: the cream-to-ink step is under one alpha level per red
  // value, so the two blend to the same pixel.
  const rgba = Buffer.from([0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 160, 0, 0, 0, 255]);
  assert.deepEqual([...lightMask(lightFromGlyph(rgba, 4), 4, 1)], [0, 0, 1, 1]);
  assert.equal(IOS_ICON_LIGHT, IOS_ICON.light);
});
