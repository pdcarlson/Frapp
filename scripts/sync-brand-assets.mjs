#!/usr/bin/env node
/**
 * Copies canonical Frapp SVGs from @repo/brand-assets into Next app routes and public dirs.
 * Run from repo root after editing packages/brand-assets/assets/*.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const canonicalIcon = join(root, "packages/brand-assets/assets/app-icon.svg");
const canonicalLockup = join(
  root,
  "packages/brand-assets/assets/frapp-lockup.svg",
);

const iconTargets = [
  join(root, "apps/landing/app/icon.svg"),
  join(root, "apps/web/app/icon.svg"),
];

const lockupPublic = join(root, "apps/landing/public/frapp-lockup.svg");

function main() {
  const iconSource = readFileSync(canonicalIcon);
  for (const dest of iconTargets) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, iconSource);
    console.log(`synced app-icon.svg -> ${dest.replace(root + "/", "")}`);
  }

  mkdirSync(dirname(lockupPublic), { recursive: true });
  copyFileSync(canonicalLockup, lockupPublic);
  console.log(
    `synced frapp-lockup.svg -> ${lockupPublic.replace(root + "/", "")}`,
  );
}

main();
