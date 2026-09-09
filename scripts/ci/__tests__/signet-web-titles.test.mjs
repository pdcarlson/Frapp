// Locks customer-facing web document titles on Signet.
//
// WHY THIS EXISTS. Live production already serves
// `Signet — Admin Dashboard`. Every metadata title under apps/web/app
// already says Signet. A leftover sweep can put Frapp back in the
// browser tab without a product-copy test noticing. #1950.
//
// SCOPE. `export const metadata` titles under apps/web/app, plus the
// root layout description. Do not walk apps/landing (frozen Frapp).
// Do not assert live staging titles (Vercel SSO, 1951).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_APP = join(REPO_ROOT, "apps/web/app");
const LAYOUT = "apps/web/app/layout.tsx";

/** Current metadata title count. A deleted title must fail, not pass. */
const MIN_METADATA_TITLES = 17;

const ROOT_TITLE = "Signet — Admin Dashboard";
const ROOT_DESCRIPTION = "Ask your chapter anything.";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!entry.isFile()) return [];
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.spec\./.test(entry.name)) return [];
    return [full];
  });
}

function metadataTitles(source) {
  const titles = [];
  const block =
    /export const metadata(?:\s*:\s*Metadata)?\s*=\s*\{([\s\S]*?)\}/g;
  for (const match of source.matchAll(block)) {
    for (const title of match[1].matchAll(/title:\s*"([^"]+)"/g)) {
      titles.push(title[1]);
    }
  }
  return titles;
}

function collectTitles() {
  const found = [];
  for (const file of walk(WEB_APP)) {
    const source = readFileSync(file, "utf8");
    if (!/export const metadata/.test(source)) continue;
    const rel = relative(REPO_ROOT, file);
    for (const title of metadataTitles(source)) {
      found.push({ rel, title });
    }
  }
  return found;
}

test("every web metadata title says Signet, not Frapp", () => {
  const found = collectTitles();
  assert.ok(
    found.length >= MIN_METADATA_TITLES,
    `expected at least ${MIN_METADATA_TITLES} metadata titles, found ${found.length}`,
  );
  for (const { rel, title } of found) {
    assert.match(title, /Signet/, `${rel}: ${title}`);
    assert.doesNotMatch(title, /Frapp/, `${rel}: ${title}`);
  }
});

test("root layout title and tagline stay Signet", () => {
  const source = readFileSync(join(REPO_ROOT, LAYOUT), "utf8");
  assert.match(
    source,
    new RegExp(`title: "${ROOT_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
  assert.match(
    source,
    new RegExp(
      `description: "${ROOT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
  );
  assert.doesNotMatch(source, /\bFrapp\b/, `${LAYOUT} must not name Frapp`);
});
