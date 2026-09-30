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
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  PLAY_FEATURE_GRAPHIC,
  PLAY_ICON,
  assertFeatureGraphicCurrent,
  auditFeatureGraphic,
  auditPlayIcon,
  fontFace,
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
const png = (pipeline) => pipeline.png().toBuffer();
const patch = (colour, width, height) => ({
  input: { create: { width, height, channels: 3, background: colour } },
});

test("the committed graphics pass every audit", async () => {
  await auditPlayIcon(icon, "icon", master);
  await auditFeatureGraphic(banner, "banner");
  await assertFeatureGraphicCurrent(banner, "banner");
});

test("the Play icon audit refuses each shape Play would not take", async () => {
  const cases = [
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

test("the feature graphic audit refuses alpha, a wrong size, edge paint and a bare field", async () => {
  const cases = [
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

test("a stale banner fails against a fresh render: a patch, a shift, a nicked crest, a colour drift", async () => {
  const { data, info } = await sharp(banner)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // The tagline recoloured by 15 levels, the size of a token realignment: every
  // non-field pixel under the lockup moves a little and none moves far.
  const drifted = Buffer.from(data);
  for (let p = 300 * info.width * 3; p < drifted.length; p += 3) {
    if (
      drifted[p] === 0x1a &&
      drifted[p + 1] === 0x1a &&
      drifted[p + 2] === 0x1a
    )
      continue;
    for (let c = 0; c < 3; c += 1)
      drifted[p + c] = Math.min(255, drifted[p + c] + 15);
  }
  const cases = [
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
    [
      await png(sharp(drifted, { raw: info })),
      /pixels differ from a fresh render/,
    ],
  ];
  for (const [input, message] of cases) {
    await assert.rejects(assertFeatureGraphicCurrent(input, "banner"), message);
  }
});

test("fontFace reads the vendored faces and refuses a file that is not a font", () => {
  assert.deepEqual(
    fontFace(readFileSync(repo("packages/theme/fonts/Figtree-Bold.ttf")), "b"),
    {
      family: "Figtree",
      weight: 700,
    },
  );
  assert.deepEqual(
    fontFace(
      readFileSync(repo("packages/theme/fonts/Figtree-Regular.ttf")),
      "r",
    ),
    {
      family: "Figtree",
      weight: 400,
    },
  );
  assert.throws(
    () =>
      fontFace(
        Buffer.from("version https://git-lfs.github.com/spec/v1\n"),
        "lfs",
      ),
    /not a readable font/,
  );
});

test("prepareFonts refuses to run after text was rendered with the host's fonts", () => {
  // fontconfig state is process-wide and read once, so this needs a process of
  // its own: render any text first, then ask for the hermetic config.
  const script = [
    `import sharp from "sharp";`,
    `await sharp({ text: { text: "x", font: "sans 12" } }).png().toBuffer();`,
    `const { prepareFonts } = await import(${JSON.stringify(LIB)});`,
    `await prepareFonts();`,
  ].join("\n");
  // Without this process's FONTCONFIG_FILE: the tests above already pointed it
  // at the hermetic config, and a child that inherits it is hermetic from the
  // start, which is the case this test must not be.
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
  assert.notEqual(
    run.status,
    0,
    "prepareFonts accepted a process whose fontconfig was already initialized",
  );
  assert.match(run.stderr, /not using the hermetic config/);
});
