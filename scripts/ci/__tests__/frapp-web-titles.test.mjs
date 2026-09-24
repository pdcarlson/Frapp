// Locks customer-facing web document titles on Frapp.
//
// WHY THIS EXISTS. A leftover sweep can put the old product name back
// in the browser tab, switch the title to single quotes the walker used
// to miss, drop the floor so a deleted title passes, or walk landing
// (its own copy lock) and treat those titles as in-scope.
//
// ADR-25 NAMES THE PRODUCT FRAPP. Step 4 moved the dashboard off Signet,
// so this lock, which was signet-web-titles, flipped: the root template
// says Frapp and Signet is the banned word, in route titles and in the
// root layout's copy.
//
// HOW THE ASSERTION INVERTED, and why the lock is stronger for it.
// This file used to require every route title to MATCH /Signet/,
// because every route spelled the product name itself
// ("Tasks — Signet", seventeen times) and the root served
// "Signet Admin Dashboard". Web greenfield lane 7 (#2147) replaced all
// seventeen with one `title.template` on the root layout, so a route
// title that still contains "Signet" now renders it TWICE
// ("Tasks · Signet · Signet"). The old assertion would have demanded
// exactly that. So the per-route check is now the inverse, and the
// "says the name" half moved to where the name is actually spelled: the
// root template, asserted once, below. Step 4 kept that shape and swapped
// the name.
//
// SCOPE. `export const metadata` titles under apps/web/app, plus the
// root layout template, default and description. Do not walk
// apps/landing (its own copy lock). Do not assert live staging titles
// (Vercel SSO, 1951). generateMetadata is absent; adding one without
// teaching the walker must fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { copyMatches } from "../lib/copy-lines.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_APP = join(REPO_ROOT, "apps/web/app");
const LAYOUT = "apps/web/app/layout.tsx";
const LOCK = fileURLToPath(import.meta.url);

/**
 * Current metadata title count. A deleted title must fail, not pass.
 *
 * 18 since #2147: the seventeen route titles, plus `(dashboard)/points/layout.tsx`,
 * which exists only to carry one — `/points` is the single real nav destination
 * whose page is a Client Component, and those cannot export `metadata`.
 */
const MIN_METADATA_TITLES = 18;

/**
 * The one place the product name is spelled. Every route title inherits it
 * through Next's `title.template`, which applies to CHILD segments only — so
 * `app/page.tsx`, in the root layout's own segment, takes `default` instead.
 */
const ROOT_TEMPLATE = "%s · Frapp";
const ROOT_DEFAULT = "Frapp";
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

export function metadataTitles(source) {
  const titles = [];
  const block =
    /export const metadata(?:\s*:\s*Metadata)?\s*=\s*\{([\s\S]*?)\}/g;
  for (const match of source.matchAll(block)) {
    for (const title of match[1].matchAll(/title:\s*["']([^"']+)["']/g)) {
      titles.push(title[1]);
    }
  }
  return titles;
}

export function collectTitles(root = WEB_APP) {
  const found = [];
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (/export (?:async )?function generateMetadata/.test(source)) {
      found.push({ rel, title: "__generateMetadata__" });
    }
    if (!/export const metadata/.test(source)) continue;
    for (const title of metadataTitles(source)) {
      found.push({ rel, title });
    }
  }
  return found;
}

export function webTitleLockProblems(source) {
  const problems = [];
  const floor = source.match(/^const MIN_METADATA_TITLES = (\d+);?$/m);
  if (!floor || floor[1] !== "18") {
    problems.push("MIN_METADATA_TITLES must stay 18");
  }
  const webApp = source.match(/^const WEB_APP = join\(REPO_ROOT, "([^"]+)"\);?$/m);
  if (!webApp || webApp[1] !== "apps/web/app") {
    problems.push("walker must stay on apps/web/app");
  }
  if (webApp && webApp[1].startsWith("apps/landing")) {
    problems.push("must not walk apps/landing");
  }
  if (!/title:\\s\*\["'\]\(\[\^"'\]\+\)\["'\]/.test(source)) {
    problems.push("must collect single-quoted and double-quoted titles");
  }
  if (!/generateMetadata/.test(source)) {
    problems.push("must fail if generateMetadata appears without a walker");
  }
  if (!/const ROOT_TEMPLATE = "%s · Frapp";/.test(source)) {
    problems.push("must assert the root title template, the only place the name is spelled");
  }
  return problems;
}

test("no web metadata title spells the product name itself", () => {
  const found = collectTitles();
  assert.ok(
    found.length >= MIN_METADATA_TITLES,
    `expected at least ${MIN_METADATA_TITLES} metadata titles, found ${found.length}`,
  );
  for (const { rel, title } of found) {
    assert.notEqual(
      title,
      "__generateMetadata__",
      `${rel}: generateMetadata must be collected before it can hide a leftover title`,
    );
    // Inverted by #2147 — see the header. A route that spells the product
    // name renders it twice, because the root template appends it.
    assert.doesNotMatch(
      title,
      /Frapp/,
      `${rel}: ${title} — the root title template appends " · Frapp"; a route must name only itself`,
    );
    assert.doesNotMatch(title, /Signet/, `${rel}: ${title}`);
  }
});

test("root layout title and tagline say Frapp", () => {
  const source = readFileSync(join(REPO_ROOT, LAYOUT), "utf8");
  // The template is what puts "Frapp" in all seventeen tabs, and `default` is
  // what the root segment's own page takes, so both have to be here: a template
  // without a default is a Next configuration error, and a default without a
  // template silently drops the name from every child route.
  assert.match(
    source,
    new RegExp(`template: "${ROOT_TEMPLATE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
  assert.match(
    source,
    new RegExp(`default: "${ROOT_DEFAULT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
  assert.match(
    source,
    new RegExp(
      `description: "${ROOT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
  );
  // The layout's comments record the Signet-era titles, so only its copy is
  // judged (the note on LINE_BREAK in ../lib/copy-lines.mjs says how).
  assert.deepEqual(
    copyMatches([{ rel: LAYOUT, source }], /\bSignet\b/g).map(({ line }) => `${LAYOUT}:${line}`),
    [],
    `${LAYOUT} must not name Signet`,
  );
});

test("walker stays on apps/web/app and keeps the title floor", () => {
  assert.deepEqual(webTitleLockProblems(readFileSync(LOCK, "utf8")), []);
});

test("dropping MIN_METADATA_TITLES below 18 fails", () => {
  const problems = webTitleLockProblems(
    readFileSync(LOCK, "utf8").replace(
      "const MIN_METADATA_TITLES = 18",
      "const MIN_METADATA_TITLES = 1",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("MIN_METADATA_TITLES")),
    problems.join("; "),
  );
});

test("pointing the walker at landing fails", () => {
  const problems = webTitleLockProblems(
    readFileSync(LOCK, "utf8").replace(
      'const WEB_APP = join(REPO_ROOT, "apps/web/app")',
      'const WEB_APP = join(REPO_ROOT, "apps/landing/app")',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/landing")),
    problems.join("; "),
  );
});

test("a single-quoted Signet metadata title is collected and fails", () => {
  const titles = metadataTitles("export const metadata = {\n  title: 'Signet — Admin'\n}");
  assert.deepEqual(titles, ["Signet — Admin"]);
  assert.match(titles[0], /Signet/);
});

test("putting Signet back in the root layout's title fails", () => {
  const source = readFileSync(join(REPO_ROOT, LAYOUT), "utf8").replace(
    'template: "%s · Frapp"',
    'template: "%s · Signet"',
  );
  assert.equal(copyMatches([{ rel: LAYOUT, source }], /\bSignet\b/g).length, 1);
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(LOCK, "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
