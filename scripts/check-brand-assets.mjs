#!/usr/bin/env node
/**
 * Verifies synced Next app icons match packages/brand-assets (byte-identical).
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const pairs = [
  {
    canonical: join(root, "packages/brand-assets/assets/app-icon.svg"),
    targets: [
      join(root, "apps/landing/app/icon.svg"),
      join(root, "apps/web/app/icon.svg"),
    ],
  },
  {
    canonical: join(root, "packages/brand-assets/assets/apple-icon.png"),
    targets: [
      join(root, "apps/landing/app/apple-icon.png"),
      join(root, "apps/web/app/apple-icon.png"),
    ],
  },
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

let failed = false;

for (const { canonical, targets } of pairs) {
  if (!existsSync(canonical)) {
    console.error(
      `missing: ${canonical} — restore or create the canonical asset before running sync`,
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
  "brand-assets: synced app/icon.svg and apple-icon.png match canonical files",
);
