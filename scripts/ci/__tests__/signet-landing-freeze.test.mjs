// Locks the landing freeze on Frapp until the USPTO unfreeze.
//
// WHY THIS EXISTS. Live frapp.live still serves Frapp marketing titles
// on purpose. A leftover sweep can flip those titles to Signet before
// the USPTO search clears. This lock is the freeze, not the unfreeze.
// The unfreeze issue (1954) replaces this file with a Signet-title lock.
//
// SCOPE. Landing metadata titles, JSON-LD SoftwareApplication / brand
// names, the lockup aria-label, and the spec freeze banner. Do not
// restyle icons or tokens. Do not change landing product copy here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LAYOUT = "apps/landing/app/layout.tsx";
const SUPPORT = "apps/landing/app/support/page.tsx";
const HOME = "apps/landing/app/page.tsx";
const LOCKUP = "apps/landing/components/frapp-lockup.tsx";
const SPEC = "spec/ui/landing/README.md";

const HOME_TITLE = "Frapp — The Operating System for Greek Life";
const SUPPORT_TITLE = "Support — Frapp";

/** Root + OG + Twitter + /support. Deleting a title must fail, not pass. */
const MIN_METADATA_TITLES = 4;

function source(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function metadataTitles(text) {
  return [...text.matchAll(/title:\s*"([^"]+)"/g)].map((match) => match[1]);
}

test("landing metadata titles stay Frapp, not Signet", () => {
  const found = [];
  for (const rel of [LAYOUT, SUPPORT]) {
    for (const title of metadataTitles(source(rel))) {
      found.push({ rel, title });
    }
  }
  assert.ok(
    found.length >= MIN_METADATA_TITLES,
    `expected at least ${MIN_METADATA_TITLES} metadata titles, found ${found.length}`,
  );
  for (const { rel, title } of found) {
    assert.match(title, /Frapp/, `${rel}: ${title}`);
    assert.doesNotMatch(title, /Signet/, `${rel}: ${title}`);
  }
});

test("home and support titles stay the frozen Frapp strings", () => {
  const layout = source(LAYOUT);
  const support = source(SUPPORT);
  const quoted = HOME_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.equal(
    [...layout.matchAll(new RegExp(`title: "${quoted}"`, "g"))].length,
    3,
    "layout metadata / OG / Twitter titles",
  );
  assert.match(support, new RegExp(`title: "${SUPPORT_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
});

test("JSON-LD application and brand names stay Frapp", () => {
  const home = source(HOME);
  const names = [...home.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.includes("Frapp"), "SoftwareApplication name");
  assert.equal(names.filter((name) => name === "Frapp").length, 2, "application + brand");
  assert.ok(!names.includes("Signet"), "JSON-LD must not name Signet yet");
});

test("lockup aria-label and spec freeze banner stay Frapp", () => {
  assert.match(source(LOCKUP), /aria-label="Frapp"/);
  assert.match(source(SPEC), /> \*\*FROZEN \(pre-Signet\)\.\*\*/);
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = source("scripts/ci/__tests__/signet-landing-freeze.test.mjs");
  assert.doesNotMatch(lock, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
});
