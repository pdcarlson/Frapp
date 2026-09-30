// The audits in `lib/store-graphics.mjs` fed inputs they must refuse.
//
// `check:brand-assets` runs them only on the committed graphics, which pass, so
// an audit that stopped refusing anything would stay green there. These are the
// cases that keep each one honest.
//
// WHY THIS IS NOT UNDER `scripts/ci/__tests__/`: that suite runs with no
// `npm ci` (see the header of `brand-pixels.test.mjs`), and these decode PNGs
// with sharp. `npm run check:brand-assets` runs this file after the gate, in the
// `lint-and-typecheck` job, where sharp is installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  FACES,
  FEATURE_RENDER_DRIFT_MAX,
  FEATURE_RENDER_ROUNDING,
  PLAY_FEATURE_GRAPHIC,
  PLAY_ICON,
  assertFacesDiffer,
  assertFeatureGraphicCurrent,
  auditFeatureGraphic,
  auditPlayIcon,
  checkFaces,
  cssColour,
  fontFace,
} from "../store-graphics.mjs";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const repo = (rel) => join(REPO_ROOT, rel);

const master = readFileSync(
  repo("packages/brand-assets/assets/signet-emblem-B.svg"),
);
const icon = readFileSync(repo(PLAY_ICON));
const banner = readFileSync(repo(PLAY_FEATURE_GRAPHIC));
const png = (pipeline) => pipeline.png().toBuffer();
const patch = (colour, width, height) => ({
  input: { create: { width, height, channels: 3, background: colour } },
});

/** The banner with the first `count` painted pixels under the lockup shifted by `levels`. */
async function drift(levels, count = Infinity) {
  const { data, info } = await sharp(banner)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  let moved = 0;
  for (let p = 300 * info.width * 3; p < out.length && moved < count; p += 3) {
    if (out[p] === 0x1a && out[p + 1] === 0x1a && out[p + 2] === 0x1a) continue;
    for (let c = 0; c < 3; c += 1)
      out[p + c] = Math.min(255, out[p + c] + levels);
    moved += 1;
  }
  return png(sharp(out, { raw: info }));
}

/** A minimal sfnt: a header and table records, each pointing at `tables[tag]`. */
function sfnt(tables) {
  const tags = Object.keys(tables);
  const header = Buffer.alloc(12 + tags.length * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(tags.length, 4);
  let offset = header.length;
  const bodies = [];
  tags.forEach((tag, i) => {
    header.write(tag, 12 + i * 16, "latin1");
    header.writeUInt32BE(offset, 12 + i * 16 + 8);
    bodies.push(tables[tag]);
    offset += tables[tag].length;
  });
  return Buffer.concat([header, ...bodies]);
}

test("the committed graphics pass every audit", async () => {
  await auditPlayIcon(icon, "icon", master);
  await auditFeatureGraphic(banner, "banner");
  await assertFeatureGraphicCurrent(banner, "banner");
});

test("text renders stay hermetic after this process rendered text with the host's fonts", async () => {
  // fontconfig keeps the config it first initialized with for the life of a
  // process. Rendering here first pins this process to the host's fonts, which
  // must not reach the banner: its text is set in a process of its own.
  await sharp({ text: { text: "host fonts", font: "sans 24" } })
    .png()
    .toBuffer();
  await assertFeatureGraphicCurrent(banner, "banner");
});

test("the Play icon audit refuses each shape Play would not take", async () => {
  const cases = [
    [
      Buffer.concat([icon, Buffer.alloc(1024 * 1024)]),
      /over Play's 1024 KB limit/,
    ],
    [await sharp(icon).jpeg().toBuffer(), /Play wants a PNG/],
    [
      readFileSync(
        repo("packages/brand-assets/assets/signet-emblem-B-1024.png"),
      ),
      /Play wants 512x512/,
    ],
    [await png(sharp(icon).removeAlpha()), /32-bit \(RGBA\)/],
    [await png(sharp(icon).removeAlpha().ensureAlpha(0.9)), /% opaque/],
    [await png(sharp(icon).flop()), /agrees with signet-emblem-B\.svg on only/],
    [
      await png(
        sharp(icon)
          .extract({ left: 0, top: 0, width: 400, height: 400 })
          .resize(512, 512),
      ),
      /corner Play's 30% radius mask removes/,
    ],
    [await png(sharp(icon).tint("#FF0000")), /#DDB844|#1A1A1A/],
  ];
  for (const [input, message] of cases) {
    await assert.rejects(auditPlayIcon(input, "icon", master), message);
  }
});

test("the feature graphic audit refuses another format, alpha, a wrong size, edge paint and a bare field", async () => {
  const cases = [
    [await sharp(banner).jpeg().toBuffer(), /this pipeline writes a PNG/],
    [await png(sharp(banner).ensureAlpha()), /alpha channel/],
    [
      await png(sharp(banner).resize(1024, 512, { fit: "fill" })),
      /exactly 1024x500/,
    ],
    [
      await png(
        sharp(banner)
          .extract({ left: 200, top: 0, width: 824, height: 500 })
          .extend({ right: 200, background: "#1A1A1A" }),
      ),
      /within 96px of an edge/,
    ],
    [
      await png(
        sharp({
          create: {
            width: 1024,
            height: 500,
            channels: 3,
            background: "#1A1A1A",
          },
        }),
      ),
      /bare field/,
    ],
  ];
  for (const [input, message] of cases) {
    await assert.rejects(auditFeatureGraphic(input, "banner"), message);
  }
});

test("a stale banner fails against a fresh render: another size, a patch, a shift, a nicked crest", async () => {
  const cases = [
    [icon, /not the size a fresh render is/],
    [
      await png(
        sharp(banner).composite([
          { ...patch("#FF0000", 60, 60), left: 600, top: 180 },
        ]),
      ),
      /levels at/,
    ],
    [
      await png(
        sharp(banner)
          .extract({ left: 1, top: 0, width: 1023, height: 500 })
          .extend({ right: 1, background: "#1A1A1A" }),
      ),
      /levels at/,
    ],
    [
      await png(
        sharp(banner).composite([
          { ...patch("#1A1A1A", 2, 2), left: 300, top: 220 },
        ]),
      ),
      /levels at/,
    ],
  ];
  for (const [input, message] of cases) {
    await assert.rejects(assertFeatureGraphicCurrent(input, "banner"), message);
  }
});

test("colour drift fails one level past rounding and one pixel past the drift limit, and not before", async () => {
  // The requirement, in absolute levels: a token moved by 3 fails, a
  // rounding-sized 1 does not. These hold whatever the constants are set to.
  await assert.rejects(
    assertFeatureGraphicCurrent(await drift(3), "banner"),
    /pixels differ/,
  );
  await assertFeatureGraphicCurrent(await drift(1), "banner");
  const past = FEATURE_RENDER_ROUNDING + 1;
  // Rounding: the whole line moved by the rounding allowance passes, and by one
  // level more fails.
  await assertFeatureGraphicCurrent(
    await drift(FEATURE_RENDER_ROUNDING),
    "banner",
  );
  await assert.rejects(
    assertFeatureGraphicCurrent(await drift(past), "banner"),
    /pixels differ/,
  );
  // Drift limit: exactly the limit's worth of pixels past rounding passes, one more fails.
  await assertFeatureGraphicCurrent(
    await drift(past, FEATURE_RENDER_DRIFT_MAX),
    "banner",
  );
  await assert.rejects(
    assertFeatureGraphicCurrent(
      await drift(past, FEATURE_RENDER_DRIFT_MAX + 1),
      "banner",
    ),
    /pixels differ/,
  );
});

test("the banner's text colours are the theme's tokens, one definition each", () => {
  const css = readFileSync(repo("packages/theme/src/signet.css"), "utf8");
  assert.equal(cssColour(css, "--foreground"), "#EDEAE3");
  assert.equal(cssColour(css, "--muted-foreground"), "#A9A399");
  assert.throws(
    () => cssColour(":root { --x: #000000; }", "--foreground"),
    /found 0/,
  );
  assert.throws(
    () =>
      cssColour(
        "  --foreground: #000000;\n  --foreground: #FFFFFF;\n",
        "--foreground",
      ),
    /found 2/,
  );
});

test("fontFace reads the vendored faces and refuses what is not a named TrueType face", () => {
  assert.deepEqual(fontFace(readFileSync(FACES[0].file), "regular"), {
    family: "Figtree",
    weight: 400,
  });
  assert.deepEqual(fontFace(readFileSync(FACES[1].file), "bold"), {
    family: "Figtree",
    weight: 700,
  });
  assert.throws(
    () =>
      fontFace(
        Buffer.from("version https://git-lfs.github.com/spec/v1\n"),
        "lfs",
      ),
    /not a TrueType file/,
  );
  assert.throws(() => fontFace(sfnt({}), "empty"), /no OS\/2 or name table/);
  // A name table whose only record is a Mac one, so no Windows family name.
  const name = Buffer.alloc(6 + 12);
  name.writeUInt16BE(1, 2); // count
  name.writeUInt16BE(18, 4); // string offset
  name.writeUInt16BE(1, 6); // platform: Macintosh
  name.writeUInt16BE(1, 12); // nameID 1
  assert.throws(
    () => fontFace(sfnt({ "OS/2": Buffer.alloc(8), name }), "mac-only"),
    /no Windows family name/,
  );
});

test("checkFaces refuses a missing face or a file that is the other face", () => {
  assert.doesNotThrow(() => checkFaces(FACES));
  assert.throws(
    () => checkFaces([{ file: "/nonexistent/Figtree-Bold.ttf", weight: 700 }]),
    /missing/,
  );
  // Regular copied over the Bold path: the file is a real font, but not the Bold one.
  assert.throws(
    () => checkFaces([{ file: FACES[0].file, weight: 700 }]),
    /declares Figtree 400, not Figtree 700/,
  );
});

test("assertFacesDiffer refuses two faces that set text identically", () => {
  const text = { png: Buffer.from([1, 2, 3]), width: 3 };
  assert.throws(
    () => assertFacesDiffer(text, { ...text }),
    /one face did not load/,
  );
  assert.doesNotThrow(() =>
    assertFacesDiffer(text, { png: Buffer.from([1, 2, 4]), width: 3 }),
  );
});
