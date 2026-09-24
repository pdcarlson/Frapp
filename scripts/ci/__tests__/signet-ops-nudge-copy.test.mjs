// Locks the ops-nudge catalog copy on Signet.
//
// WHY THIS EXISTS. The nudge catalog says Signet, and the catalog spec bans
// trial language but not a brand. A leftover sweep that changes the brand in
// the catalog would ship the wrong name.
//
// ADR-25 NAMES THE PRODUCT FRAPP and renames it one surface at a time. This
// lock also held the mobile payment-copy fixtures until step 2 moved the
// mobile binary to Frapp and split them out into frapp-mobile-copy.test.mjs.
// The catalog is rendered by the web dashboard (ops-setup-nudge.tsx), so it
// flips with step 4: the headlines become Frapp and Signet becomes the
// banned word.
//
// SCOPE. Nudge headlines/descriptions. Do not run eas init.
//
// The first lock imported DUES_HEADLINE into every assert, so rewriting
// the const and the catalog together off Signet would still pass. Pin
// the assignment lines. Walk packages/validation for a second
// ops-nudges.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const VALIDATION_ROOT = join(REPO_ROOT, "packages/validation");
const NUDGES = "packages/validation/src/ops-nudges.ts";

/** One catalog file. A second ops-nudges.ts is drift. */
const MIN_OPS_NUDGE_FILES = 1;
const EXPECTED_OPS_NUDGE_FILES = [NUDGES];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);

export const DUES_HEADLINE = "Collect dues in Signet";
export const EVENTS_HEADLINE = "Run your calendar in Signet";

export function nudgeCopyProblems(source) {
  const problems = [];
  if (!new RegExp(`headline:\\s*"${DUES_HEADLINE}"`).test(source)) {
    problems.push(`dues headline must be ${DUES_HEADLINE}`);
  }
  if (!new RegExp(`headline:\\s*"${EVENTS_HEADLINE}"`).test(source)) {
    problems.push(`events headline must be ${EVENTS_HEADLINE}`);
  }
  if (/headline:\s*"[^"]*\bFrapp\b/.test(source)) {
    problems.push("nudge headline must not name Frapp");
  }
  if (/description:\s*"[^"]*\bFrapp\b/.test(source)) {
    problems.push("nudge description must not name Frapp");
  }
  return problems;
}

export function walkNamedFiles(dir, name) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkNamedFiles(path, name));
      continue;
    }
    if (entry.isFile() && entry.name === name) out.push(path);
  }
  return out;
}

function relOf(path) {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

export function catalogSites(files) {
  return files.map((file) => file.rel).sort();
}

export function walkedCatalogProblems(files) {
  const problems = [];
  const sites = catalogSites(files);
  if (sites.length < MIN_OPS_NUDGE_FILES) {
    problems.push("packages/validation must keep ops-nudges.ts");
  }
  for (const site of sites) {
    if (!EXPECTED_OPS_NUDGE_FILES.includes(site)) {
      problems.push(`${site}:unexpected`);
    }
  }
  for (const expected of EXPECTED_OPS_NUDGE_FILES) {
    if (!sites.includes(expected)) problems.push(`${expected}:missing`);
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const dues = source.match(/^export const DUES_HEADLINE = "([^"]+)";?$/m);
  if (!dues || dues[1] !== "Collect dues in Signet") {
    problems.push("DUES_HEADLINE must stay Collect dues in Signet");
  }
  const events = source.match(/^export const EVENTS_HEADLINE = "([^"]+)";?$/m);
  if (!events || events[1] !== "Run your calendar in Signet") {
    problems.push("EVENTS_HEADLINE must stay Run your calendar in Signet");
  }
  const nudges = source.match(/^const NUDGES = "([^"]+)";?$/m);
  if (!nudges || nudges[1] !== "packages/validation/src/ops-nudges.ts") {
    problems.push("must read packages/validation/src/ops-nudges.ts");
  }
  if (nudges && nudges[1].startsWith("apps/landing")) {
    problems.push("must not read apps/landing");
  }
  const validationRoot = source.match(
    /^const VALIDATION_ROOT = join\(REPO_ROOT, "([^"]+)"\);?$/m,
  );
  if (!validationRoot || validationRoot[1] !== "packages/validation") {
    problems.push("catalog walker must stay on packages/validation");
  }
  if (validationRoot && validationRoot[1].startsWith("apps/landing")) {
    problems.push("must not walk apps/landing only");
  }
  const catalogFloor = source.match(/^const MIN_OPS_NUDGE_FILES = (\d+);?$/m);
  if (!catalogFloor || catalogFloor[1] !== "1") {
    problems.push("MIN_OPS_NUDGE_FILES must stay 1");
  }
  if (/assert\.(ok|equal|deepEqual|match)\([^\n]*extra\.eas\.projectId/.test(source)) {
    problems.push("must not require extra.eas.projectId");
  }
  return problems;
}

function liveCatalogFiles() {
  return walkNamedFiles(VALIDATION_ROOT, "ops-nudges.ts").map((path) => ({
    rel: relOf(path),
  }));
}

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

test("live ops-nudge catalog stays Signet", () => {
  assert.deepEqual(nudgeCopyProblems(readRepo(NUDGES)), []);
  assert.deepEqual(catalogSites(liveCatalogFiles()), EXPECTED_OPS_NUDGE_FILES);
  assert.deepEqual(walkedCatalogProblems(liveCatalogFiles()), []);
});

test("putting Frapp in a nudge headline fails", () => {
  const source = readRepo(NUDGES).replace(
    DUES_HEADLINE,
    "Collect dues in Frapp",
  );
  const problems = nudgeCopyProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("Frapp")),
    problems.join("; "),
  );
});

test("renaming a Signet headline fails", () => {
  const source = readRepo(NUDGES).replace(
    EVENTS_HEADLINE,
    "Run your calendar in the app",
  );
  const problems = nudgeCopyProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("events headline")),
    problems.join("; "),
  );
});

test("a second ops-nudges.ts site fails the walk", () => {
  const files = [{ rel: NUDGES }, { rel: "packages/validation/src/extra-ops-nudges.ts" }];
  assert.deepEqual(
    walkedCatalogProblems(files).filter((problem) => problem.includes("extra")),
    ["packages/validation/src/extra-ops-nudges.ts:unexpected"],
  );
});

test("lock pins the Signet headline assignment and refuses a projectId require", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("rewriting DUES_HEADLINE off Signet fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'export const DUES_HEADLINE = "Collect dues in Signet"',
      'export const DUES_HEADLINE = "Collect dues in Frapp"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("DUES_HEADLINE")),
    problems.join("; "),
  );
});

test("pointing the catalog reader at landing fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const NUDGES = "packages/validation/src/ops-nudges.ts"',
      'const NUDGES = "apps/landing/ops-nudges.ts"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/landing")),
    problems.join("; "),
  );
});

test("dropping the catalog floor fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      "const MIN_OPS_NUDGE_FILES = 1",
      "const MIN_OPS_NUDGE_FILES = 0",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("MIN_OPS_NUDGE_FILES")),
    problems.join("; "),
  );
});

test("requiring extra.eas.projectId fails", () => {
  const plantedAssert = [
    "assert.ok(",
    "app.expo.extra.eas.projectId);",
  ].join("");
  const problems = lockSelfProblems(
    `${readFileSync(LOCK, "utf8")}\n${plantedAssert}\n`,
  );
  assert.ok(
    problems.some((problem) => problem.includes("projectId")),
    problems.join("; "),
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  assert.doesNotMatch(
    readFileSync(LOCK, "utf8"),
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
