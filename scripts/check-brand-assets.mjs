#!/usr/bin/env node
/**
 * The CI gate over the committed Signet brand assets.
 *
 * Four independent properties, because before #2153 this script checked only
 * the first one and it proved nothing about the mark:
 *
 *   1. PARITY — synced Next app icons are byte-identical to their canonical
 *      source. Catches a hand-edited copy or a forgotten `sync:brand-assets`.
 *
 *   2. VECTORS — every shipped SVG paints the locked pair and nothing else,
 *      in the shared coordinate frame. Not just the two the rasters render
 *      from: `signet-emblem-B-rounded.svg` and `frapp-lockup.svg` are
 *      `@repo/brand-assets` exports that reach consumers directly, and no
 *      raster check can see them.
 *
 *   3. PIXELS — the committed rasters are drawn in the locked pair, carry the
 *      channel shape their consumer requires, every glyph layer is non-empty,
 *      and the rasters are still a render of the committed vector.
 *
 *   4. CONTAINMENT — `favicon.ico` is a container, and it holds exactly the
 *      censused favicon rasters. Nothing above can see inside an `.ico`, which
 *      is how `apps/web/app/favicon.ico` shipped Next's scaffold icon through
 *      green CI for as long as the file existed.
 *
 * Hash parity is blind to 2, 3 and 4: every file could agree perfectly with
 * every other file and still be the wrong colour, which is exactly the state
 * #2153 found — a full pixel census of the pre-#2153 masters returned `#DDB844` in
 * ZERO pixels while this script reported success.
 *
 * This reads pixels rather than trusting a re-run of `rasterize:brand-assets`,
 * because the gate has to hold for whatever is committed — including a file
 * someone dropped in by hand.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FIELD,
  FIELD_HEX,
  GOLD_HEX,
  ICO_SIZES,
  RENDER_AGREEMENT_MIN,
  SYNCED,
  assertGlyphCoverage,
  assertIcoContains,
  assertLockedPair,
  assertSvgLocked,
  census,
  coverageMask,
  glyphCoverage,
  maskIou,
} from "./lib/brand-pixels.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const repo = (rel) => join(root, rel);

const MASTER_SVG = "packages/brand-assets/assets/signet-emblem-B.svg";
const GLYPH_SVG = "packages/brand-assets/assets/signet-emblem-B-glyph.svg";
const MASTER_RASTER = "packages/brand-assets/assets/signet-emblem-B-1024.png";
const FAVICON_ICO = "packages/brand-assets/assets/signet-emblem-B.ico";
const canonicalRaster = (size) =>
  `packages/brand-assets/assets/signet-emblem-B-${size}.png`;

/** Every shipped vector. `requireField` is false for the crest-alone glyph. */
const vectors = [
  { rel: MASTER_SVG },
  { rel: GLYPH_SVG, requireField: false },
  { rel: "packages/brand-assets/assets/signet-emblem-B-rounded.svg" },
  { rel: "packages/brand-assets/assets/frapp-lockup.svg" },
];

/**
 * Opaque RGB rasters. All of them, not a sample: the 16px favicon is the one
 * most likely to lose the mark to antialiasing, and the mobile `icon.png` is
 * the one that reaches an app store.
 */
const opaqueRasters = [
  "packages/brand-assets/assets/signet-emblem-B-16.png",
  "packages/brand-assets/assets/signet-emblem-B-32.png",
  "packages/brand-assets/assets/signet-emblem-B-48.png",
  "packages/brand-assets/assets/signet-emblem-B-180.png",
  MASTER_RASTER,
  "apps/mobile/assets/images/icon.png",
  "apps/mobile/assets/images/favicon.png",
];

/**
 * Crest-on-transparency layers. Their alpha IS the mark, so an empty layer is
 * visible here — which was NOT true while these composited an opaque tile: a
 * charcoal square with the crest missing measured exactly the same 43.58%.
 */
const glyphLayers = [
  "packages/brand-assets/assets/signet-emblem-B-glyph-1024.png",
  "apps/mobile/assets/images/adaptive-icon.png",
  "apps/mobile/assets/images/splash-icon.png",
];

/** White-on-transparent, deliberately off the brand axis: alpha only. */
const monochromeLayers = [
  "apps/mobile/assets/images/adaptive-icon-monochrome.png",
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

let failed = false;

function fail(message) {
  console.error(message);
  failed = true;
}

function present(rel, hint) {
  if (existsSync(repo(rel))) return true;
  fail(`missing: ${rel}${hint ? ` — ${hint}` : ""}`);
  return false;
}

// ── 1. Vectors ──────────────────────────────────────────────────────────────
for (const { rel, requireField } of vectors) {
  if (!present(rel, "the vector sources every raster renders from")) continue;
  try {
    assertSvgLocked(readFileSync(repo(rel), "utf8"), rel, { requireField });
  } catch (error) {
    fail(String(error.message ?? error));
  }
}

// ── 2. Parity ───────────────────────────────────────────────────────────────
let syncedCount = 0;
for (const { canonical, targets } of SYNCED) {
  if (
    !present(
      canonical,
      "run npm run rasterize:brand-assets then npm run sync:brand-assets",
    )
  ) {
    continue;
  }
  const expectedHash = sha256(readFileSync(repo(canonical)));
  for (const dest of targets) {
    if (!present(dest, "run: node scripts/sync-brand-assets.mjs")) continue;
    syncedCount += 1;
    if (sha256(readFileSync(repo(dest))) !== expectedHash) {
      fail(`drift: ${dest}\n  run: node scripts/sync-brand-assets.mjs`);
    }
  }
}

// ── 3. Pixels ───────────────────────────────────────────────────────────────
async function decode(rel) {
  const buffer = readFileSync(repo(rel));
  const [{ data, info }, meta] = await Promise.all([
    sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(buffer).metadata(),
  ]);
  return { data, info, meta };
}

for (const rel of opaqueRasters) {
  if (!present(rel, "run npm run rasterize:brand-assets")) continue;
  try {
    const { data, info, meta } = await decode(rel);
    if (meta.channels !== 3) {
      throw new Error(
        `${rel}: has ${meta.channels} channels — must be opaque RGB, Apple rejects an alpha channel on a store icon (spec/ui/assets.md §7)`,
      );
    }
    assertLockedPair(
      census(data, info.channels, info.width, info.height, 255),
      rel,
      { edge: info.width },
    );
  } catch (error) {
    fail(`${rel}: ${String(error.message ?? error)}`.replace(`${rel}: ${rel}: `, `${rel}: `));
  }
}

for (const rel of glyphLayers) {
  if (!present(rel, "run npm run rasterize:brand-assets")) continue;
  try {
    const { data, info, meta } = await decode(rel);
    if (meta.channels !== 4) {
      throw new Error(`${rel}: must carry an alpha channel`);
    }
    assertLockedPair(
      census(data, info.channels, info.width, info.height, 255),
      rel,
      { requireField: false },
    );
    assertGlyphCoverage(
      glyphCoverage(data, info.channels, info.width, info.height),
      rel,
    );
  } catch (error) {
    fail(`${rel}: ${String(error.message ?? error)}`.replace(`${rel}: ${rel}: `, `${rel}: `));
  }
}

for (const rel of monochromeLayers) {
  if (!present(rel, "run npm run rasterize:brand-assets")) continue;
  try {
    const { data, info } = await decode(rel);
    assertGlyphCoverage(
      glyphCoverage(data, info.channels, info.width, info.height),
      rel,
    );
  } catch (error) {
    fail(`${rel}: ${String(error.message ?? error)}`.replace(`${rel}: ${rel}: `, `${rel}: `));
  }
}

// ── 4. The rasters are still a render of the vector ─────────────────────────
// The property hash parity cannot express: someone edits the SVG, does not
// re-run rasterize, and the committed PNGs quietly go on describing the old
// artwork. That divergence between vector and raster IS #2153.
//
// This compares GLYPH MASKS, so it is colour-blind by construction — a recolour
// scores ~100% here. Property 1 above is what catches that, which is why it
// covers every SVG and not only this pair.
if (existsSync(repo(MASTER_SVG)) && existsSync(repo(MASTER_RASTER))) {
  try {
    const shape = async (input) => {
      const { data, info } = await sharp(input)
        .resize(1024, 1024, { fit: "fill" })
        .flatten({ background: { ...FIELD, alpha: 1 } })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return coverageMask(data, info.channels, info.width, info.height);
    };
    const agreement = maskIou(
      await shape(readFileSync(repo(MASTER_SVG))),
      await shape(readFileSync(repo(MASTER_RASTER))),
    );
    if (agreement < RENDER_AGREEMENT_MIN) {
      fail(
        `stale: signet-emblem-B-1024.png agrees with signet-emblem-B.svg on only ` +
          `${(agreement * 100).toFixed(3)}% of the glyph (floor ${(RENDER_AGREEMENT_MIN * 100).toFixed(1)}%)\n` +
          `  the vector master was edited without re-rendering — run: npm run rasterize:brand-assets`,
      );
    }
  } catch (error) {
    fail(
      `could not compare signet-emblem-B.svg to its raster: ${String(error.message ?? error)}`,
    );
  }
}

// ── 5. The favicon container holds the censused rasters ─────────────────────
// Properties 1-3 are all structurally blind to an `.ico`: parity only proves
// the copy under `apps/` equals the canonical, and no census above ever opens
// the container. That blind spot is not hypothetical — it is why
// `apps/web/app/favicon.ico` sat on Next's scaffold icon, black-and-white
// artwork nobody in this repo drew, while every run of this script passed.
//
// The payloads are audited BY INHERITANCE: they must be byte-identical to the
// favicon rasters, which the opaque-raster census above reads. That inheritance
// is asserted rather than assumed — drop one of those rasters from the census
// roster and the favicon would quietly lose its pixel gate with nothing to say
// so.
for (const size of ICO_SIZES) {
  if (!opaqueRasters.includes(canonicalRaster(size))) {
    fail(
      `${canonicalRaster(size)} is a favicon.ico payload but is not in the opaque-raster census — ` +
        `the container check leans on that census for its pixels, so removing it here exempts the favicon too`,
    );
  }
}

const payloads = ICO_SIZES.map((size) => canonicalRaster(size));
// `existsSync` throughout, never `present`: every file this section reads is
// already reported when missing — the `.ico` by the SYNCED parity loop that now
// carries it, the three payloads by the census roster above. Reporting either
// twice, with two differently worded hints, only buries the real failure.
if (
  existsSync(repo(FAVICON_ICO)) &&
  payloads.every((rel) => existsSync(repo(rel)))
) {
  try {
    assertIcoContains(
      readFileSync(repo(FAVICON_ICO)),
      FAVICON_ICO,
      payloads.map((rel) => readFileSync(repo(rel))),
    );
  } catch (error) {
    fail(String(error.message ?? error));
  }
}

if (failed) {
  process.exit(1);
}
console.log(
  `brand-assets: ${vectors.length} vectors paint ${GOLD_HEX} on ${FIELD_HEX}; ` +
    `${syncedCount} synced copies match canonical; ` +
    `${opaqueRasters.length} opaque rasters in the locked pair; ` +
    `${glyphLayers.length + monochromeLayers.length} glyph layers non-empty; ` +
    `favicon.ico holds the ${ICO_SIZES.join("/")} rasters verbatim`,
);
