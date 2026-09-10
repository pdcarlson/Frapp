#!/usr/bin/env node
/**
 * Rasterizes locked Signet emblem B into Expo launcher icons and the
 * committed 1024 master PNG. Run from repo root after editing
 * packages/brand-assets/assets/*.svg.
 *
 * iOS Light / Dark / Tinted store variants and Play Console feature
 * graphics are not produced here — those stay an Ops / EAS step.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const assets = join(root, "packages/brand-assets/assets");
const mobileImages = join(root, "apps/mobile/assets/images");
const FIELD = "#1A1A1A";
const GOLD = "#DDB844";

const iconSvg = readFileSync(join(assets, "app-icon.svg"));
const glyphSvg = readFileSync(join(assets, "app-icon-glyph.svg"));

function densityFor(size, viewBox = 64) {
  return (size / viewBox) * 72;
}

async function pngFromSvg(svg, size) {
  return sharp(svg, { density: densityFor(size) })
    .resize(size, size)
    .png()
    .toBuffer();
}

function recolorGlyph(fill) {
  return Buffer.from(
    glyphSvg.toString("utf8").replaceAll(GOLD, fill),
    "utf8",
  );
}

async function opaqueIcon(size) {
  const tile = await pngFromSvg(iconSvg, size);
  return sharp(tile)
    .flatten({ background: FIELD })
    .removeAlpha()
    .png()
    .toBuffer();
}

async function paddedGlyph(fill, size, insetRatio = 0.17) {
  const inner = Math.round(size * (1 - insetRatio * 2));
  const glyph = await pngFromSvg(recolorGlyph(fill), inner);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toBuffer();
}

async function write(rel, buffer) {
  const dest = join(root, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buffer);
  console.log(`wrote ${rel} (${buffer.length} bytes)`);
}

async function main() {
  mkdirSync(mobileImages, { recursive: true });

  await write(
    "packages/brand-assets/assets/signet-emblem-B-locked.png",
    await opaqueIcon(1024),
  );
  await write("apps/mobile/assets/images/icon.png", await opaqueIcon(1024));
  await write(
    "apps/mobile/assets/images/adaptive-icon.png",
    await paddedGlyph(GOLD, 1024),
  );
  await write(
    "apps/mobile/assets/images/adaptive-icon-monochrome.png",
    await paddedGlyph("#FFFFFF", 1024),
  );
  await write(
    "apps/mobile/assets/images/splash-icon.png",
    await paddedGlyph(GOLD, 1024),
  );
  await write("apps/mobile/assets/images/favicon.png", await opaqueIcon(96));
  await write(
    "packages/brand-assets/assets/apple-icon.png",
    await opaqueIcon(180),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
