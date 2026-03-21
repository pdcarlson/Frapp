#!/usr/bin/env node
/**
 * Verifies app/icon.svg files match packages/brand-assets/assets/app-icon.svg (byte-identical).
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const canonical = join(root, "packages/brand-assets/assets/app-icon.svg");
const targets = [
  join(root, "apps/landing/app/icon.svg"),
  join(root, "apps/web/app/icon.svg"),
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const expected = readFileSync(canonical);
const expectedHash = sha256(expected);
let failed = false;

for (const dest of targets) {
  let actual;
  try {
    actual = readFileSync(dest);
  } catch {
    console.error(`missing: ${dest}`);
    failed = true;
    continue;
  }
  const h = sha256(actual);
  if (h !== expectedHash) {
    console.error(`drift: ${dest}\n  run: node scripts/sync-brand-assets.mjs`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(
  "brand-assets: all app/icon.svg files match canonical app-icon.svg",
);
