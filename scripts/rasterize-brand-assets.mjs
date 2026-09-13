#!/usr/bin/env node
/**
 * Renders every Signet raster from the vector masters in
 * `packages/brand-assets/assets/`.
 *
 * WHY THE SVG IS THE SOURCE, AND NOT A PNG (#2153). Until this change the
 * source of truth was a 1280x720 JPEG-derived "Design lock" PNG, letterboxed
 * around a ~454px tile that this script cropped and upscaled 2.26x. That master
 * held `#DDB844` in zero pixels — it measured `#DDA220` on `#151515`, 24,069
 * distinct colours in a two-colour design — so every raster under it shipped
 * compression artifacts while the spec said otherwise, and no check could see
 * it: `check:brand-assets` compared sha256 hashes and never read a pixel.
 *
 * A vector master cannot drift from its own colours. Every size below is now a
 * supersampled render of that vector rather than an upscale of an upscale, and
 * every buffer is audited AS WRITTEN — see `scripts/lib/brand-pixels.mjs` for
 * why each layer shape gets a different audit.
 *
 * NAMING. Canonical assets are `signet-emblem-B[-glyph|-rounded][-<size>].<ext>`
 * — see `packages/brand-assets/README.md`. The names written into `apps/` are
 * fixed by Expo and by the Next App Router, not by us.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FIELD,
  FIELD_HEX,
  GOLD_HEX,
  ICO_SIZES,
  assertFullyOpaque,
  assertGlyphCoverage,
  assertIcoShape,
  assertLockedPair,
  assertSvgLocked,
  buildIco,
  census,
  coverage,
  glyphCoverage,
} from "./lib/brand-pixels.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const assets = join(root, "packages/brand-assets/assets");
const mobileImages = join(root, "apps/mobile/assets/images");

const MASTER_SVG = join(assets, "signet-emblem-B.svg");
const GLYPH_SVG = join(assets, "signet-emblem-B-glyph.svg");
const FLATTEN = { ...FIELD, alpha: 1 };

/**
 * Render the vectors once at this size, then downscale for every smaller
 * raster. Rendering a 16px favicon straight from the vector drops hairlines
 * (the whisker, the neck break) that supersampling preserves.
 */
const SUPERSAMPLE = 1024;

/**
 * Inset for the Android launcher mask: `spec/ui/assets.md` §7 wants the glyph
 * well inside the 66% safe zone so a circular or squircle mask never clips it.
 */
const LAUNCHER_INSET = 0.17;

/**
 * Renders a vector at `SUPERSAMPLE`. No cropping: the SVG IS the frame.
 *
 * The letterbox-detecting `contentSquare()` this replaces existed only to dig a
 * tile out of Design's 16:9 JPEG upload. It keyed off a four-corner luminance
 * mean against a hard-coded `< 16`, and on the real master it returned a 454px
 * box for a 448px-wide tile — pulling ~3px of letterbox into every icon before
 * upscaling the result. A heuristic that can now only misfire is worse than no
 * heuristic.
 */
async function renderVector(path) {
  return sharp(readFileSync(path))
    .resize(SUPERSAMPLE, SUPERSAMPLE, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Opaque RGB. Apple rejects an alpha channel on a store icon. */
async function opaque(source, size) {
  return sharp(source)
    .resize(size, size, { fit: "fill" })
    .flatten({ background: FLATTEN })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * The same tile as `opaque()`, keeping an alpha channel that is 255 everywhere.
 *
 * Only the favicon container wants this. Next builds `app/favicon.ico` through
 * Turbopack, whose ICO decoder refuses a non-RGBA PNG payload and fails the
 * production build, while `spec/ui/assets.md` §7 requires the canonical rasters
 * to stay opaque RGB for the store icon. The two constraints are both real, so
 * the container gets its own render rather than either one bending.
 */
async function opaqueRgba(source, size) {
  return sharp(source)
    .resize(size, size, { fit: "fill" })
    .flatten({ background: FLATTEN })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * The crest alone, full bleed, on transparency.
 *
 * Rendered from `signet-emblem-B-glyph.svg` rather than keyed out of the opaque
 * tile, so its edges antialias against transparency instead of against
 * charcoal — a glyph keyed out of a dark tile carries a dark fringe onto every
 * light surface it lands on.
 */
async function transparent(source, size) {
  return sharp(source)
    .resize(size, size, { fit: "fill" })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * The crest alone, inset on transparency, for the Android adaptive foreground
 * and the splash image.
 *
 * These used to composite the OPAQUE tile — a charcoal square on transparency —
 * which `spec/ui/assets.md` §7 never described and which had two costs. The
 * splash plugin paints `#131211` behind it, so a charcoal square showed as a
 * hard-edged rectangle on the first screen of the app; and a launcher mask
 * clipped the square's corners rather than the transparent margin that inset
 * was there to provide. It also made the layer uncheckable: the alpha channel
 * described the inset square, so a crest-less tile measured identically.
 */
async function insetGlyph(svgPath, size, insetRatio = LAUNCHER_INSET) {
  const inner = Math.round(size * (1 - insetRatio * 2));
  // Straight from the vector at the inset size. Downscaling a 1024 render to
  // 676 instead pushes edge pixels up to 2.15 units off the brand axis through
  // lanczos overshoot; a first-generation render lands them at 0.
  const glyph = await transparent(readFileSync(svgPath), inner);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: glyph, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * The Android themed-icon layer: the same inset crest, in white.
 *
 * The classifier this replaces was a radius-90 euclidean ball around the gold
 * centroid — see `lib/brand-pixels.mjs` for why that was one re-export away
 * from emitting an empty PNG. Here the source is already glyph-on-transparent,
 * so alpha carries the shape and `coverage()` only has to reject the fringe.
 */
async function monochrome(insetBuffer) {
  const { data, info } = await sharp(insetBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const visible = out[i + 3] >= 128 && coverage(out[i], out[i + 1], out[i + 2]) >= 0.5;
    if (visible) {
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = 255;
    } else {
      // Zero the colour as well as the alpha: a transparent pixel still
      // carrying gold bytes bleeds on any consumer that downscales without
      // premultiplying.
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
    }
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Audits a buffer AS WRITTEN. `check:brand-assets` runs the same assertions
 * over the COMMITTED files in CI; doing it here too fails a bad export at the
 * point it is produced rather than one commit later.
 *
 * Measuring the written buffer and not an intermediate matters: an earlier
 * revision asserted glyph coverage on the pre-composite inner tile, so the
 * exporter and the gate applied one band to two numbers 2.29x apart and the
 * exporter could certify a file the gate then rejected.
 */
async function audit(buffer, label, kind) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const meta = await sharp(buffer).metadata();
  // Colour is claimed over fully opaque pixels; coverage over visible ones.
  const stats = census(data, info.channels, info.width, info.height, 255);

  if (kind === "opaque") {
    if (meta.channels !== 3) {
      throw new Error(
        `${label}: has ${meta.channels} channels — must be opaque RGB, Apple rejects an alpha channel on a store icon (spec/ui/assets.md §7)`,
      );
    }
    assertLockedPair(stats, label, { edge: info.width });
  } else if (kind === "opaqueRgba") {
    // The inverse requirement of "opaque", and for a different consumer: a
    // favicon payload MUST carry alpha or Turbopack refuses the container.
    if (meta.channels !== 4) {
      throw new Error(
        `${label}: has ${meta.channels} channels — an .ico payload must be RGBA or Turbopack's decoder refuses it`,
      );
    }
    assertFullyOpaque(data, info.channels, label);
    assertLockedPair(stats, label, { edge: info.width });
  } else if (kind === "glyph") {
    if (meta.channels !== 4) {
      throw new Error(`${label}: must carry an alpha channel`);
    }
    assertLockedPair(stats, label, { requireField: false });
    assertGlyphCoverage(
      glyphCoverage(data, info.channels, info.width, info.height),
      label,
    );
  } else if (kind === "monochrome") {
    assertGlyphCoverage(
      glyphCoverage(data, info.channels, info.width, info.height),
      label,
    );
  }
  return stats;
}

async function write(rel, buffer) {
  const dest = join(root, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buffer);
  console.log(`wrote ${rel} (${buffer.length} bytes)`);
}

async function emit(rel, buffer, kind) {
  const stats = await audit(buffer, rel, kind);
  await write(rel, buffer);
  return stats;
}

async function main() {
  // Every shipped SVG, not just the two the rasters render from: the rounded
  // tile and the lockup are `@repo/brand-assets` exports that reach consumers
  // directly, and no raster check can see them.
  assertSvgLocked(readFileSync(MASTER_SVG, "utf8"), "signet-emblem-B.svg");
  assertSvgLocked(readFileSync(GLYPH_SVG, "utf8"), "signet-emblem-B-glyph.svg", {
    requireField: false,
  });
  assertSvgLocked(
    readFileSync(join(assets, "signet-emblem-B-rounded.svg"), "utf8"),
    "signet-emblem-B-rounded.svg",
  );
  assertSvgLocked(
    readFileSync(join(assets, "frapp-lockup.svg"), "utf8"),
    "frapp-lockup.svg",
  );

  mkdirSync(mobileImages, { recursive: true });

  const markHi = await renderVector(MASTER_SVG);
  const glyphHi = await renderVector(GLYPH_SVG);

  // ── canonical: packages/brand-assets/assets ───────────────────────────────
  const tiles = new Map();
  for (const size of [16, 32, 48, 180, 1024]) {
    const buffer = await opaque(markHi, size);
    const stats = await emit(
      `packages/brand-assets/assets/signet-emblem-B-${size}.png`,
      buffer,
      "opaque",
    );
    tiles.set(size, buffer);
    if (size === 1024) {
      console.log(
        `master: ${GOLD_HEX} ${((100 * stats.gold) / stats.total).toFixed(2)}%, ` +
          `${FIELD_HEX} ${((100 * stats.field) / stats.total).toFixed(2)}%, ` +
          `worst ${stats.worstOffAxis.toFixed(2)} off-axis`,
      );
    }
  }
  const tile1024 = tiles.get(1024);

  // The favicon container. Its payloads are the same paint as the canonical
  // rasters above with an opaque alpha channel added, because Turbopack's ICO
  // decoder requires RGBA and the canonical rasters must stay RGB — see
  // `opaqueRgba` for why neither constraint can give way. Each is audited as
  // written before it is packed, exactly like every other buffer here, and
  // `check:brand-assets` then proves each payload's RGB plane is byte-identical
  // to the canonical raster of its size, so the favicon still cannot come to
  // describe different artwork than the `app/icon.png` beside it.
  const faviconPayloads = [];
  for (const size of ICO_SIZES) {
    const payload = await opaqueRgba(markHi, size);
    await audit(payload, `signet-emblem-B.ico[${size}]`, "opaqueRgba");
    faviconPayloads.push(payload);
  }
  const favicon = buildIco(faviconPayloads);
  assertIcoShape(favicon, "signet-emblem-B.ico", ICO_SIZES);
  await write("packages/brand-assets/assets/signet-emblem-B.ico", favicon);

  await emit(
    "packages/brand-assets/assets/signet-emblem-B-glyph-1024.png",
    await transparent(glyphHi, 1024),
    "glyph",
  );

  // ── Expo: names fixed by apps/mobile/app.json ─────────────────────────────
  // `icon.png` reuses the audited 1024 buffer rather than re-rendering it, so
  // the store-bound icon cannot diverge from the tile it is supposed to be.
  await emit("apps/mobile/assets/images/icon.png", tile1024, "opaque");
  await emit(
    "apps/mobile/assets/images/favicon.png",
    await opaque(markHi, 96),
    "opaque",
  );

  const launcher = await insetGlyph(GLYPH_SVG, 1024);
  await emit("apps/mobile/assets/images/adaptive-icon.png", launcher, "glyph");
  await emit("apps/mobile/assets/images/splash-icon.png", launcher, "glyph");
  await emit(
    "apps/mobile/assets/images/adaptive-icon-monochrome.png",
    await monochrome(launcher),
    "monochrome",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
