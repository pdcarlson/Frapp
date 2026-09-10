#!/usr/bin/env node
/**
 * Verifies synced Next app icons match packages/brand-assets (byte-identical)
 * and that the Design master is a real PNG (not a JPEG leftover).
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const master = join(
  root,
  "packages/brand-assets/assets/signet-emblem-B-locked.png",
);

const pairs = [
  {
    canonical: join(root, "packages/brand-assets/assets/icon.png"),
    targets: [
      join(root, "apps/landing/app/icon.png"),
      join(root, "apps/web/app/icon.png"),
    ],
  },
  {
    canonical: join(root, "packages/brand-assets/assets/apple-icon.png"),
    targets: [
      join(root, "apps/landing/app/apple-icon.png"),
      join(root, "apps/web/app/apple-icon.png"),
    ],
  },
  {
    canonical: join(
      root,
      "packages/brand-assets/assets/signet-emblem-B-tile.png",
    ),
    targets: [
      join(root, "apps/landing/public/brand/signet-emblem-B.png"),
      join(root, "apps/web/public/brand/signet-emblem-B.png"),
      join(root, "apps/landing/app/opengraph-emblem.png"),
    ],
  },
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function isPng(buf) {
  return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

let failed = false;

if (!existsSync(master)) {
  console.error("missing: packages/brand-assets/assets/signet-emblem-B-locked.png");
  failed = true;
} else {
  const masterBuf = readFileSync(master);
  if (!isPng(masterBuf)) {
    console.error(
      "master is not a PNG — rasterize will refuse it. Commit Design's PNG, do not rasterize from SVG.",
    );
    failed = true;
  }
}

for (const { canonical, targets } of pairs) {
  if (!existsSync(canonical)) {
    console.error(
      `missing: ${canonical} — run npm run rasterize:brand-assets then npm run sync:brand-assets`,
    );
    failed = true;
    continue;
  }
  const expectedHash = sha256(readFileSync(canonical));
  for (const dest of targets) {
    let actual;
    try {
      actual = readFileSync(dest);
    } catch {
      console.error(`missing: ${dest}`);
      failed = true;
      continue;
    }
    if (sha256(actual) !== expectedHash) {
      console.error(`drift: ${dest}\n  run: node scripts/sync-brand-assets.mjs`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log(
  "brand-assets: synced icon.png, apple-icon.png, and emblem tile match canonical files",
);
