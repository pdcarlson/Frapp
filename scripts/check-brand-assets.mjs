#!/usr/bin/env node
/**
 * The CI gate over the committed Signet brand assets.
 *
 * Seven independent properties, numbered as the sections below are, because
 * before #2153 this script checked only parity and it proved nothing about
 * the mark:
 *
 *   1. VECTORS — every shipped SVG paints the locked pair and nothing else,
 *      in the shared coordinate frame. Not just the two the rasters render
 *      from: `signet-emblem-B-rounded.svg` and `frapp-lockup.svg` are
 *      `@repo/brand-assets` exports that reach consumers directly, and no
 *      raster check can see them.
 *
 *   2. PARITY — synced Next app icons are byte-identical to their canonical
 *      source. Catches a hand-edited copy or a forgotten `sync:brand-assets`.
 *
 *   3. PIXELS — the committed rasters are drawn in the locked pair, carry the
 *      channel shape their consumer requires, and every glyph layer is
 *      non-empty.
 *
 *   4. STALENESS — the rasters are still a render of the committed vector.
 *
 *   5. CONTAINMENT — `favicon.ico` is a container, and every payload in it is
 *      the canonical raster of its size plus an opaque alpha channel: same
 *      paint, same artwork, in the RGBA shape Turbopack's ICO decoder requires.
 *      Nothing above can see inside an `.ico`, which is how
 *      `apps/web/app/favicon.ico` shipped Next's scaffold icon through green CI
 *      for as long as the file existed.
 *
 *   6. IOS ICON — the Icon Composer bundle `expo.ios.icon` names is exactly
 *      what `scripts/lib/ios-icon.mjs` writes: its `icon.json`, and a crest
 *      whose path is the glyph vector's in the locked gold. No raster exists
 *      until Xcode compiles it, so there are no pixels to check instead.
 *
 *   7. STORE GRAPHICS — the Google Play icon and feature graphic under
 *      `apps/mobile/store/graphics/` are the shape Play takes, the icon is
 *      still a render of the vector, and the feature graphic is what the
 *      renderer draws today. The audits live in `scripts/lib/store-graphics.mjs`,
 *      shared with `rasterize-brand-assets.mjs`.
 *
 * Hash parity (2) is blind to every other property: every file could agree
 * perfectly with every other file and still be the wrong colour, which is
 * exactly the state #2153 found — a full pixel census of the pre-#2153 masters
 * returned `#DDB844` in ZERO pixels while this script reported success.
 *
 * This reads pixels rather than trusting a re-run of `rasterize:brand-assets`,
 * because the gate has to hold for whatever is committed — including a file
 * someone dropped in by hand.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FIELD_HEX,
  GOLD_HEX,
  ICO_SIZES,
  RENDER_AGREEMENT_MIN,
  SHIPPED_VECTORS,
  SYNCED,
  assertGlyphCoverage,
  assertFullyOpaque,
  assertIcoShape,
  assertLockedPair,
  assertSvgLocked,
  census,
  glyphCoverage,
  maskIou,
} from "./lib/brand-pixels.mjs";
import {
  IOS_ICON_CREST,
  IOS_ICON_DIR,
  IOS_ICON_JSON,
  crestSvg,
  glyphPath,
  iconJson,
} from "./lib/ios-icon.mjs";
import {
  PLAY_FEATURE_GRAPHIC,
  PLAY_ICON,
  assertFeatureGraphicCurrent,
  auditFeatureGraphic,
  auditPlayIcon,
  decode as decodeBuffer,
  vectorMask,
} from "./lib/store-graphics.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const repo = (rel) => join(root, rel);

const MASTER_SVG = "packages/brand-assets/assets/signet-emblem-B.svg";
const MASTER_RASTER = "packages/brand-assets/assets/signet-emblem-B-1024.png";
const FAVICON_ICO = "packages/brand-assets/assets/signet-emblem-B.ico";
const canonicalRaster = (size) =>
  `packages/brand-assets/assets/signet-emblem-B-${size}.png`;

/** Every shipped vector: `SHIPPED_VECTORS`, the one list (scripts/lib/brand-pixels.mjs). */
const vectors = SHIPPED_VECTORS.map(({ name, requireField }) => ({
  rel: `packages/brand-assets/assets/${name}`,
  requireField,
}));

/**
 * Opaque RGB rasters. All of them, not a sample: the 16px favicon is the one
 * most likely to lose the mark to antialiasing, and the mobile `icon.png` is
 * the full-bleed tile Expo uses wherever no platform-specific icon is set.
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
function decode(rel) {
  return decodeBuffer(readFileSync(repo(rel)));
}

for (const rel of opaqueRasters) {
  if (!present(rel, "run npm run rasterize:brand-assets")) continue;
  try {
    const { data, info, meta } = await decode(rel);
    if (meta.channels !== 3) {
      throw new Error(
        `${rel}: has ${meta.channels} channels — must be opaque RGB, the full-bleed tile (spec/ui/assets.md §7)`,
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
    const agreement = maskIou(
      await vectorMask(readFileSync(repo(MASTER_SVG)), 1024),
      await vectorMask(readFileSync(repo(MASTER_RASTER)), 1024),
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

// ── 5. The favicon container ────────────────────────────────────────────────
// Properties 1-3 are all structurally blind to an `.ico`: parity only proves
// the copy under `apps/` equals the canonical, and no census above ever opens
// the container. That blind spot is not hypothetical — it is why
// `apps/web/app/favicon.ico` sat on Next's scaffold icon, black-and-white
// artwork nobody in this repo drew, while every run of this script passed.
//
// Two properties, because the container cannot simply re-use the canonical
// buffers. Turbopack's ICO decoder requires RGBA payloads and fails the web
// production build on anything else, while the canonical rasters must stay
// opaque RGB, the full-bleed tile. So the payloads carry the same paint with an
// opaque alpha channel, and this asserts exactly that: the RGBA SHAPE the
// toolchain needs, and RGB PLANE equality with the canonical raster of the same
// size — which is what a census alone can never prove, since the locked pair
// drawn as a different mark censuses identically.
const payloads = ICO_SIZES.map((size) => canonicalRaster(size));
// `existsSync` throughout, never `present`: every file this section reads is
// already reported when missing — the `.ico` by the SYNCED parity loop that now
// carries it, the canonical rasters by the census roster above. Reporting
// either twice, with two differently worded hints, only buries the real failure.
if (
  existsSync(repo(FAVICON_ICO)) &&
  payloads.every((rel) => existsSync(repo(rel)))
) {
  try {
    const entries = assertIcoShape(
      readFileSync(repo(FAVICON_ICO)),
      FAVICON_ICO,
      ICO_SIZES,
    );
    const rgb = async (input) => {
      const { data, info } = await sharp(input)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { data, info };
    };
    for (const [index, entry] of entries.entries()) {
      // Alpha first, and on its own: the comparison below strips it, so this is
      // the only place anything measures the channel the payload carries.
      const withAlpha = await sharp(entry.payload)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assertFullyOpaque(
        withAlpha.data,
        withAlpha.info.channels,
        `${FAVICON_ICO}[${entry.width}]`,
      );
      const payload = await rgb(entry.payload);
      const canonical = await rgb(readFileSync(repo(payloads[index])));
      assertLockedPair(
        census(payload.data, payload.info.channels, payload.info.width, payload.info.height, 255),
        `${FAVICON_ICO}[${entry.width}]`,
        { edge: entry.width },
      );
      if (!payload.data.equals(canonical.data)) {
        fail(
          `${FAVICON_ICO}: its ${entry.width}x${entry.width} payload is not ${payloads[index]} with an opaque alpha channel — ` +
            `the favicon is drawing artwork no other surface draws\n  run: npm run rasterize:brand-assets`,
        );
      }
    }
  } catch (error) {
    fail(String(error.message ?? error));
  }
}

// ── 6. The iOS icon bundle ──────────────────────────────────────────────────
// Exact equality with what `rasterize-brand-assets.mjs` writes, rather than a
// looser shape check: the document has no pixels to measure, and a hand edit
// to it (or to the crest's copy of the path) is exactly the drift this gate
// exists for. Stray files in `Assets/` fail too: Xcode compiles what it finds.
// Line endings are compared as LF, so a Windows checkout with `core.autocrlf`
// does not read as drift; `glyphPath` refuses a glyph `crest.svg` cannot copy.
const lf = (text) => text.replace(/\r\n/g, "\n");
if (present(IOS_ICON_JSON, "run npm run rasterize:brand-assets")) {
  if (lf(readFileSync(repo(IOS_ICON_JSON), "utf8")) !== iconJson()) {
    fail(
      `drift: ${IOS_ICON_JSON} is not what scripts/lib/ios-icon.mjs writes\n  run: npm run rasterize:brand-assets`,
    );
  }
}
if (present(IOS_ICON_CREST, "run npm run rasterize:brand-assets")) {
  try {
    const committed = lf(readFileSync(repo(IOS_ICON_CREST), "utf8"));
    assertSvgLocked(committed, IOS_ICON_CREST, { requireField: false });
    const glyph = readFileSync(
      repo("packages/brand-assets/assets/signet-emblem-B-glyph.svg"),
      "utf8",
    );
    if (committed !== crestSvg(glyphPath(glyph, "signet-emblem-B-glyph.svg"))) {
      fail(
        `stale: ${IOS_ICON_CREST} does not draw signet-emblem-B-glyph.svg's path\n  run: npm run rasterize:brand-assets`,
      );
    }
    // Dotfiles are skipped: a Finder `.DS_Store` is gitignored and never
    // reaches CI or Xcode, and re-running the rasterizer cannot remove it.
    const assets = readdirSync(repo(`${IOS_ICON_DIR}/Assets`)).filter(
      (name) => !name.startsWith("."),
    );
    if (assets.length !== 1 || assets[0] !== "crest.svg") {
      fail(`${IOS_ICON_DIR}/Assets: holds ${assets.join(", ")}; it holds crest.svg only`);
    }
  } catch (error) {
    fail(String(error.message ?? error));
  }
}

// ── 7. Store graphics ───────────────────────────────────────────────────────
// Nothing ships these in a binary: the owner uploads them in Play Console. They
// are gated anyway because the Play icon IS the mark, and a listing that shows
// an old crest beside a new app is the same drift #2153 was.
if (present(PLAY_ICON, "run npm run rasterize:brand-assets")) {
  try {
    await auditPlayIcon(
      readFileSync(repo(PLAY_ICON)),
      PLAY_ICON,
      readFileSync(repo(MASTER_SVG)),
    );
  } catch (error) {
    fail(String(error.message ?? error));
  }
}
if (present(PLAY_FEATURE_GRAPHIC, "run npm run rasterize:brand-assets")) {
  try {
    const buffer = readFileSync(repo(PLAY_FEATURE_GRAPHIC));
    await auditFeatureGraphic(buffer, PLAY_FEATURE_GRAPHIC);
    await assertFeatureGraphicCurrent(buffer, PLAY_FEATURE_GRAPHIC);
  } catch (error) {
    fail(String(error.message ?? error));
  }
}

if (failed) {
  process.exit(1);
}
console.log(
  `brand-assets: ${vectors.length} vectors paint only ${GOLD_HEX} / ${FIELD_HEX}; ` +
    `${syncedCount} synced copies match canonical; ` +
    `${opaqueRasters.length} opaque rasters in the locked pair; ` +
    `${glyphLayers.length + monochromeLayers.length} glyph layers non-empty; ` +
    `favicon.ico holds the ${ICO_SIZES.join("/")} rasters as RGBA; ` +
    `the iOS icon bundle draws the glyph; ` +
    `the Play icon and feature graphic are the shape Play takes and current`,
);
