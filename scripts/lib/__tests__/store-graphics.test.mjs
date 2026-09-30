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
//
// The staleness limits are tested against a FRESH render of this host, never
// the committed banner: the limits exist to absorb rounding between hosts, so a
// boundary drawn on the committed file would move on exactly those hosts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  FACES,
  FEATURE_RENDER_DRIFT_MAX,
  FEATURE_RENDER_ROUNDING,
  FEATURE_RENDER_WORST,
  PLAY_FEATURE_GRAPHIC,
  PLAY_ICON,
  assertFacesDiffer,
  assertFeatureGraphicCurrent,
  auditFeatureGraphic,
  auditPlayIcon,
  checkFaces,
  cssColour,
  fontFace,
  renderFeatureGraphic,
} from "../store-graphics.mjs";

const LIB = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "store-graphics.mjs",
);
const REPO_ROOT = join(dirname(LIB), "..", "..");
const repo = (rel) => join(REPO_ROOT, rel);

const master = readFileSync(
  repo("packages/brand-assets/assets/signet-emblem-B.svg"),
);
const icon = readFileSync(repo(PLAY_ICON));
const banner = readFileSync(repo(PLAY_FEATURE_GRAPHIC));
const signetCss = readFileSync(repo("packages/theme/src/signet.css"), "utf8");
const fresh = await renderFeatureGraphic();
const png = (pipeline) => pipeline.png().toBuffer();
const patch = (colour, width, height) => ({
  input: { create: { width, height, channels: 3, background: colour } },
});

/**
 * The fresh render with the painted pixels under the lockup (the line) shifted
 * by `levels`: all of them, or the first `count`.
 */
async function drift(levels, count = Infinity) {
  const { data, info } = await sharp(fresh)
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

/** A face that declares `family` at `weight`, with one name record on `platform`. */
function face(family, weight, platform = 3) {
  const os2 = Buffer.alloc(8);
  os2.writeUInt16BE(weight, 4);
  const string = Buffer.from(family, "utf16le").swap16();
  const name = Buffer.alloc(18);
  name.writeUInt16BE(1, 2); // count
  name.writeUInt16BE(18, 4); // string offset
  name.writeUInt16BE(platform, 6);
  name.writeUInt16BE(1, 8); // encoding
  name.writeUInt16BE(1, 12); // nameID 1, the family
  name.writeUInt16BE(string.length, 14);
  return sfnt({ "OS/2": os2, name: Buffer.concat([name, string]) });
}

test("the committed graphics pass every audit", async () => {
  await auditPlayIcon(icon, "icon", master);
  await auditFeatureGraphic(banner, "banner");
  await assertFeatureGraphicCurrent(banner, "banner");
});

test("text stays hermetic in a process that rendered with the host's fonts first", () => {
  // Its own process with the host's environment, because fontconfig keeps the
  // config it first initialized with, and in this file's process the renders
  // above already started it. The child pins itself to the host's fonts, then
  // checks the committed banner, which it can only match if the banner's text
  // is set in a process of its own under the hermetic config.
  const script = [
    `import { readFileSync } from "node:fs";`,
    `import sharp from "sharp";`,
    `await sharp({ text: { text: "host fonts", font: "sans 24" } }).png().toBuffer();`,
    `const lib = await import(${JSON.stringify(LIB)});`,
    `await lib.assertFeatureGraphicCurrent(readFileSync(${JSON.stringify(repo(PLAY_FEATURE_GRAPHIC))}), "banner");`,
  ].join("\n");
  const env = { ...process.env };
  delete env.FONTCONFIG_FILE;
  const run = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
    },
  );
  assert.equal(run.status, 0, run.stderr);
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
        sharp(fresh).composite([
          { ...patch("#FF0000", 60, 60), left: 600, top: 180 },
        ]),
      ),
      /levels at/,
    ],
    [
      await png(
        sharp(fresh)
          .extract({ left: 1, top: 0, width: 1023, height: 500 })
          .extend({ right: 1, background: "#1A1A1A" }),
      ),
      /levels at/,
    ],
    [
      await png(
        sharp(fresh).composite([
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

test("one pixel fails past the worst-pixel limit and not at it, and a 32-level move always fails", async () => {
  await assertFeatureGraphicCurrent(
    await drift(FEATURE_RENDER_WORST, 1),
    "banner",
  );
  await assert.rejects(
    assertFeatureGraphicCurrent(
      await drift(FEATURE_RENDER_WORST + 1, 1),
      "banner",
    ),
    /levels at/,
  );
  await assert.rejects(
    assertFeatureGraphicCurrent(await drift(32, 1), "banner"),
    /levels at/,
  );
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
  await assertFeatureGraphicCurrent(
    await drift(FEATURE_RENDER_ROUNDING),
    "banner",
  );
  await assert.rejects(
    assertFeatureGraphicCurrent(await drift(past), "banner"),
    /pixels differ/,
  );
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

test("the banner's text is set in the theme's colour tokens", async () => {
  // --muted-foreground swapped for pure red in a copy of the theme: the line
  // comes out red only if the render reads the stylesheet.
  const red = signetCss.replace(
    /^(\s*--muted-foreground:\s*)#[0-9A-Fa-f]{6}/m,
    "$1#FF0000",
  );
  assert.notEqual(red, signetCss);
  const data = await sharp(await renderFeatureGraphic({ css: red }))
    .raw()
    .toBuffer();
  let redPixels = 0;
  for (let p = 300 * 1024 * 3; p < data.length; p += 3) {
    if (data[p] === 255 && data[p + 1] === 0 && data[p + 2] === 0)
      redPixels += 1;
  }
  assert.ok(
    redPixels > 500,
    `expected the line in #FF0000, found ${redPixels} such pixels`,
  );
});

test("cssColour reads exactly one #RRGGBB definition", () => {
  assert.match(cssColour(signetCss, "--foreground"), /^#[0-9A-F]{6}$/);
  assert.match(cssColour(signetCss, "--muted-foreground"), /^#[0-9A-F]{6}$/);
  assert.equal(
    cssColour(
      "  --foreground: #abcdef;\n  --muted-foreground: #000000;\n",
      "--foreground",
    ),
    "#ABCDEF",
  );
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
  assert.deepEqual(fontFace(face("Inter", 700), "inter"), {
    family: "Inter",
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
  assert.throws(
    () => fontFace(face("Figtree", 700, 1), "mac-only"),
    /no Windows family name/,
  );
});

test("checkFaces refuses a missing face, the other weight, and another family", () => {
  assert.doesNotThrow(() => checkFaces(FACES));
  assert.throws(
    () => checkFaces([{ file: "/nonexistent/Figtree-Bold.ttf", weight: 700 }]),
    /missing/,
  );
  // Regular copied over the Bold path: a real font, but not the Bold one.
  assert.throws(
    () => checkFaces([{ file: FACES[0].file, weight: 700 }]),
    /declares Figtree 400, not Figtree 700/,
  );
  // Another family's bold at the Bold path.
  const bold = join(
    mkdtempSync(join(tmpdir(), "frapp-face-")),
    "Figtree-Bold.ttf",
  );
  writeFileSync(bold, face("Inter", 700));
  assert.throws(
    () => checkFaces([{ file: bold, weight: 700 }]),
    /declares Inter 700, not Figtree 700/,
  );
});

test("the feature graphic refuses two faces that set text identically", async () => {
  const text = { png: Buffer.from([1, 2, 3]), width: 3, height: 1 };
  assert.throws(
    () => assertFacesDiffer(text, { ...text }),
    /one face did not load/,
  );
  assert.doesNotThrow(() =>
    assertFacesDiffer(text, { ...text, png: Buffer.from([1, 2, 4]) }),
  );
  // And the render checks its own probe: a renderer that sets every string
  // the same, as one that lost a face would, is stopped before composing.
  await assert.rejects(
    renderFeatureGraphic({ render: (texts) => texts.map(() => ({ ...text })) }),
    /one face did not load/,
  );
});
