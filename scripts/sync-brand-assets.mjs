#!/usr/bin/env node
/**
 * Copies canonical Signet rasters from @repo/brand-assets into Next app
 * routes and public dirs. Run from repo root after rasterize.
 */
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const canonicalIcon = join(root, "packages/brand-assets/assets/icon.png");
const canonicalTile = join(
  root,
  "packages/brand-assets/assets/signet-emblem-B-tile.png",
);
const canonicalApple = join(
  root,
  "packages/brand-assets/assets/apple-icon.png",
);

const iconTargets = [
  join(root, "apps/landing/app/icon.png"),
  join(root, "apps/web/app/icon.png"),
];

const staleSvgIcons = [
  join(root, "apps/landing/app/icon.svg"),
  join(root, "apps/web/app/icon.svg"),
];

const appleTargets = [
  join(root, "apps/landing/app/apple-icon.png"),
  join(root, "apps/web/app/apple-icon.png"),
];

const tileTargets = [
  join(root, "apps/landing/public/brand/signet-emblem-B.png"),
  join(root, "apps/web/public/brand/signet-emblem-B.png"),
  join(root, "apps/landing/app/opengraph-emblem.png"),
];

function copy(src, dest, label) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));
  console.log(`synced ${label} -> ${dest.replace(root + "/", "")}`);
}

function main() {
  for (const dest of iconTargets) copy(canonicalIcon, dest, "icon.png");
  for (const dest of appleTargets) copy(canonicalApple, dest, "apple-icon.png");
  for (const dest of tileTargets) {
    copy(canonicalTile, dest, "signet-emblem-B-tile.png");
  }
  for (const stale of staleSvgIcons) {
    if (existsSync(stale)) {
      unlinkSync(stale);
      console.log(`removed superseded ${stale.replace(root + "/", "")}`);
    }
  }
  const staleLockup = join(root, "apps/landing/public/frapp-lockup.svg");
  if (existsSync(staleLockup)) {
    unlinkSync(staleLockup);
    console.log("removed superseded apps/landing/public/frapp-lockup.svg");
  }
}

main();
