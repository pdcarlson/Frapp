#!/usr/bin/env node
/**
 * Copies canonical Signet rasters from @repo/brand-assets into Next app
 * routes and public dirs. Run from repo root after rasterize.
 *
 * The destination names are NOT ours: `app/icon.png`, `app/apple-icon.png` and
 * `app/favicon.ico` are Next App Router file conventions, and
 * `public/brand/signet-emblem-B.png` is the path the components request. The
 * canonical sources they come from follow the package's own scheme
 * (`signet-emblem-B[-glyph][-<size>].<ext>`), so the rename happens here, on copy.
 *
 * WHAT TO COPY IS NOT DECIDED HERE. The canonical -> destination manifest is
 * `SYNCED` in `lib/brand-pixels.mjs`, which `check-brand-assets.mjs` also walks
 * to assert byte parity. This script used to keep its own parallel lists of the
 * same pairs, so the two could disagree — and they disagreed in the silent
 * direction, since a destination added to the copier alone is simply never
 * gated. `apps/web/app/favicon.ico` is what that cost: it was in neither list,
 * shipped Next's scaffold icon, and passed CI for as long as it existed.
 */
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SYNCED } from "./lib/brand-pixels.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const repo = (rel) => join(root, rel);

/**
 * Files an earlier revision of this script wrote, or that Next resolved ahead
 * of the synced icon. Removed rather than left: `app/icon.svg` outranks
 * `app/icon.png` in the App Router's own precedence order, so a leftover one
 * silently wins over the file this script just wrote.
 */
const superseded = [
  "apps/landing/app/icon.svg",
  "apps/web/app/icon.svg",
  "apps/landing/public/frapp-lockup.svg",
];

function main() {
  for (const { canonical, targets } of SYNCED) {
    const buffer = readFileSync(repo(canonical));
    for (const dest of targets) {
      mkdirSync(dirname(repo(dest)), { recursive: true });
      writeFileSync(repo(dest), buffer);
      console.log(`synced ${basename(canonical)} -> ${dest}`);
    }
  }
  for (const stale of superseded) {
    if (existsSync(repo(stale))) {
      unlinkSync(repo(stale));
      console.log(`removed superseded ${stale}`);
    }
  }
}

main();
