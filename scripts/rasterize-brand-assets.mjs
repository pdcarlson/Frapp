#!/usr/bin/env node
/**
 * Derives Expo launcher icons, Next favicons, and Apple touch icons from
 * the canonical Design raster `signet-emblem-B-locked.png`.
 *
 * The master PNG is never overwritten. Edit that file (Design's lock),
 * then re-run this script. iOS Light / Dark / Tinted store variants and
 * Play Console feature graphics stay an Ops / EAS step.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const assets = join(root, "packages/brand-assets/assets");
const mobileImages = join(root, "apps/mobile/assets/images");
const MASTER = join(assets, "signet-emblem-B-locked.png");
const FIELD = { r: 0x1a, g: 0x1a, b: 0x1a, alpha: 1 };
const GOLD = { r: 0xdd, g: 0xb8, b: 0x44 };

function assertPngMagic(buf, label) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    throw new Error(`${label} is not a PNG (refusing JPEG-as-png or SVG raster leftovers)`);
  }
}

/**
 * Design's upload is a 16:9 letterbox around a centered charcoal tile.
 * JPEG letterbox is not pure black (~rgb 10), so crop from luminance
 * relative to the corners. A square full-bleed master is a no-op.
 */
async function contentSquare(input) {
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 1 || height < 1) {
    throw new Error("master raster has no dimensions");
  }

  const lumAt = (x, y) => {
    const i = (y * width + x) * channels;
    return (data[i] + data[i + 1] + data[i + 2]) / 3;
  };
  const cornerLum =
    (lumAt(0, 0) +
      lumAt(width - 1, 0) +
      lumAt(0, height - 1) +
      lumAt(width - 1, height - 1)) /
    4;
  const centerLum = lumAt(Math.floor(width / 2), Math.floor(height / 2));
  const letterboxed = cornerLum < 16 && centerLum - cornerLum > 6;

  if (!letterboxed) {
    const side = Math.min(width, height);
    return {
      left: Math.round((width - side) / 2),
      top: Math.round((height - side) / 2),
      width: side,
      height: side,
    };
  }

  const threshold = cornerLum + 5;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (lumAt(x, y) > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) {
    throw new Error("master raster has no visible tile to crop");
  }
  const side = Math.max(maxX - minX + 1, maxY - minY + 1);
  const cx = Math.round((minX + maxX) / 2);
  const cy = Math.round((minY + maxY) / 2);
  const left = Math.max(0, Math.min(width - side, cx - Math.floor(side / 2)));
  const top = Math.max(0, Math.min(height - side, cy - Math.floor(side / 2)));
  return {
    left,
    top,
    width: Math.min(side, width - left),
    height: Math.min(side, height - top),
  };
}

async function opaqueTile(size) {
  const master = readFileSync(MASTER);
  const region = await contentSquare(master);
  return sharp(master)
    .extract(region)
    .resize(size, size, { fit: "fill" })
    .flatten({ background: FIELD })
    .removeAlpha()
    .png()
    .toBuffer();
}

async function paddedTile(size, insetRatio = 0.17) {
  const inner = Math.round(size * (1 - insetRatio * 2));
  const tile = await opaqueTile(inner);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: tile, gravity: "center" }])
    .png()
    .toBuffer();
}

async function paddedMonochrome(size, insetRatio = 0.17) {
  const inner = Math.round(size * (1 - insetRatio * 2));
  const tile = await opaqueTile(inner);
  const { data, info } = await sharp(tile)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const dr = out[i] - GOLD.r;
    const dg = out[i + 1] - GOLD.g;
    const db = out[i + 2] - GOLD.b;
    const goldish = dr * dr + dg * dg + db * db < 90 * 90;
    if (goldish) {
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = 255;
    } else {
      out[i + 3] = 0;
    }
  }
  const glyph = await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
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
  const master = readFileSync(MASTER);
  assertPngMagic(master, "packages/brand-assets/assets/signet-emblem-B-locked.png");
  mkdirSync(mobileImages, { recursive: true });

  const tile1024 = await opaqueTile(1024);
  await write("packages/brand-assets/assets/signet-emblem-B-tile.png", tile1024);
  await write("apps/mobile/assets/images/icon.png", tile1024);
  await write(
    "apps/mobile/assets/images/adaptive-icon.png",
    await paddedTile(1024),
  );
  await write(
    "apps/mobile/assets/images/adaptive-icon-monochrome.png",
    await paddedMonochrome(1024),
  );
  await write(
    "apps/mobile/assets/images/splash-icon.png",
    await paddedTile(1024),
  );
  await write("apps/mobile/assets/images/favicon.png", await opaqueTile(96));
  await write("packages/brand-assets/assets/favicon-16.png", await opaqueTile(16));
  await write("packages/brand-assets/assets/favicon-32.png", await opaqueTile(32));
  await write("packages/brand-assets/assets/favicon-48.png", await opaqueTile(48));
  await write("packages/brand-assets/assets/icon.png", await opaqueTile(32));
  await write("packages/brand-assets/assets/apple-icon.png", await opaqueTile(180));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
