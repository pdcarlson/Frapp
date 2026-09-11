#!/usr/bin/env node
/**
 * Copies canonical Signet rasters from @repo/brand-assets into Next app
 * routes and public dirs. Run from repo root after rasterize.
 *
 * The destination names are NOT ours: `app/icon.png` and `app/apple-icon.png`
 * are Next App Router file conventions, and `public/brand/signet-emblem-B.png`
 * is the path the components request. The canonical sources they come from
 * follow the package's own scheme (`signet-emblem-B[-glyph][-<size>].<ext>`),
 * so the rename happens here, on copy.
 */
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const canonicalIcon = join(
  root,
  "packages/brand-assets/assets/signet-emblem-B-32.png",
);
const canonicalTile = join(
  root,
  "packages/brand-assets/assets/signet-emblem-B-1024.png",
);
const canonicalApple = join(
  root,
  "packages/brand-assets/assets/signet-emblem-B-180.png",
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
  for (const dest of iconTargets) copy(canonicalIcon, dest, "signet-emblem-B-32.png");
  for (const dest of appleTargets) copy(canonicalApple, dest, "signet-emblem-B-180.png");
  for (const dest of tileTargets) {
    copy(canonicalTile, dest, "signet-emblem-B-1024.png");
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
