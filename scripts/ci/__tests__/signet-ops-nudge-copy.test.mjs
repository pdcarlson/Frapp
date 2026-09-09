// Locks already-Signet ops-nudge copy and retires Frapp payment fixtures.
//
// WHY THIS EXISTS. The nudge catalog already says Signet. Production
// PaymentSheet / Expo Go pay copy is already Signet (merchant leftover
// 1952). Two mobile specs still fixture Frapp, and the catalog spec bans
// trial language but not Frapp. A leftover sweep that matches the
// fixtures, or that puts Frapp back in the catalog, would ship the wrong
// brand.
//
// SCOPE. Nudge headlines/descriptions and the two payment fixtures.
// Leave app.json name / scheme / bundle id / Settings path on the
// store-name leftover (1829). Leave production stripe.ts / dues.tsx on
// 1952. Store-identity freeze stays on 1967. Do not run eas init.
//
// The first lock imported DUES_HEADLINE into every assert, so rewriting
// the const and the catalog together off Signet would still pass. Pin
// the assignment lines. Walk packages/validation for a second
// ops-nudges.ts and apps/mobile specs for a third Frapp fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const VALIDATION_ROOT = join(REPO_ROOT, "packages/validation");
const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile");
const NUDGES = "packages/validation/src/ops-nudges.ts";
const STRIPE_SPEC = "apps/mobile/lib/payments/stripe.spec.ts";
const BALANCE_SPEC = "apps/mobile/components/dues/balance-card.spec.tsx";

/** One catalog file. A second ops-nudges.ts is drift. */
const MIN_OPS_NUDGE_FILES = 1;
const EXPECTED_OPS_NUDGE_FILES = [NUDGES];
/** One Signet PaymentSheet fixture. A Frapp value anywhere is drift. */
const MIN_MERCHANT_SIGNET_SPECS = 1;
/** One installed-Signet fixture. A Frapp value anywhere is drift. */
const MIN_INSTALLED_SIGNET_SPECS = 1;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);
const SPEC_EXT = /\.spec\.(?:ts|tsx)$/;

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

export function paymentFixtureProblems({ stripeSpec, balanceSpec }) {
  const problems = [];
  if (/merchantDisplayName:\s*"Frapp"/.test(stripeSpec)) {
    problems.push(`${STRIPE_SPEC} must not pass merchantDisplayName Frapp`);
  }
  if (!/merchantDisplayName:\s*"Signet"/.test(stripeSpec)) {
    problems.push(`${STRIPE_SPEC} must pass merchantDisplayName Signet`);
  }
  if (/installed Frapp build/.test(balanceSpec)) {
    problems.push(`${BALANCE_SPEC} must not fixture installed Frapp build`);
  }
  if (!/installed Signet build/.test(balanceSpec)) {
    problems.push(`${BALANCE_SPEC} must fixture installed Signet build`);
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

export function walkMobileSpecs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkMobileSpecs(path));
      continue;
    }
    if (entry.isFile() && SPEC_EXT.test(entry.name)) out.push(path);
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

export function collectMerchantDisplayNames(source) {
  return [...source.matchAll(/merchantDisplayName:\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
}

export function walkedMerchantProblems(files) {
  const problems = [];
  let signetSpecs = 0;
  for (const { rel, source } of files) {
    const names = collectMerchantDisplayNames(source);
    if (names.length === 0) continue;
    if (names.includes("Frapp")) {
      problems.push(`${rel}:merchantDisplayName Frapp`);
    }
    if (names.includes("Signet")) signetSpecs += 1;
  }
  if (signetSpecs < MIN_MERCHANT_SIGNET_SPECS) {
    problems.push("apps/mobile specs must keep a Signet merchantDisplayName");
  }
  return problems;
}

export function walkedInstalledBuildProblems(files) {
  const problems = [];
  let signetSpecs = 0;
  for (const { rel, source } of files) {
    if (/installed Frapp build/.test(source)) {
      problems.push(`${rel}:installed Frapp build`);
    }
    if (/installed Signet build/.test(source)) signetSpecs += 1;
  }
  if (signetSpecs < MIN_INSTALLED_SIGNET_SPECS) {
    problems.push("apps/mobile specs must keep an installed Signet build fixture");
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
  const stripe = source.match(/^const STRIPE_SPEC = "([^"]+)";?$/m);
  if (!stripe || stripe[1] !== "apps/mobile/lib/payments/stripe.spec.ts") {
    problems.push("must read apps/mobile/lib/payments/stripe.spec.ts");
  }
  const balance = source.match(/^const BALANCE_SPEC = "([^"]+)";?$/m);
  if (!balance || balance[1] !== "apps/mobile/components/dues/balance-card.spec.tsx") {
    problems.push("must read apps/mobile/components/dues/balance-card.spec.tsx");
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
  const mobileRoot = source.match(
    /^const MOBILE_ROOT = join\(REPO_ROOT, "([^"]+)"\);?$/m,
  );
  if (!mobileRoot || mobileRoot[1] !== "apps/mobile") {
    problems.push("fixture walker must stay on apps/mobile");
  }
  if (mobileRoot && mobileRoot[1].startsWith("apps/landing")) {
    problems.push("must not walk apps/landing only");
  }
  const catalogFloor = source.match(/^const MIN_OPS_NUDGE_FILES = (\d+);?$/m);
  if (!catalogFloor || catalogFloor[1] !== "1") {
    problems.push("MIN_OPS_NUDGE_FILES must stay 1");
  }
  const merchantFloor = source.match(
    /^const MIN_MERCHANT_SIGNET_SPECS = (\d+);?$/m,
  );
  if (!merchantFloor || merchantFloor[1] !== "1") {
    problems.push("MIN_MERCHANT_SIGNET_SPECS must stay 1");
  }
  const installedFloor = source.match(
    /^const MIN_INSTALLED_SIGNET_SPECS = (\d+);?$/m,
  );
  if (!installedFloor || installedFloor[1] !== "1") {
    problems.push("MIN_INSTALLED_SIGNET_SPECS must stay 1");
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

function liveMobileSpecs() {
  return walkMobileSpecs(MOBILE_ROOT).map((path) => ({
    rel: relOf(path),
    source: readFileSync(path, "utf8"),
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

test("live payment fixtures stay Signet", () => {
  assert.deepEqual(
    paymentFixtureProblems({
      stripeSpec: readRepo(STRIPE_SPEC),
      balanceSpec: readRepo(BALANCE_SPEC),
    }),
    [],
  );
  assert.deepEqual(walkedMerchantProblems(liveMobileSpecs()), []);
  assert.deepEqual(walkedInstalledBuildProblems(liveMobileSpecs()), []);
});

test("restoring a Frapp PaymentSheet fixture fails", () => {
  const stripeSpec = readRepo(STRIPE_SPEC).replaceAll(
    'merchantDisplayName: "Signet"',
    'merchantDisplayName: "Frapp"',
  );
  const problems = paymentFixtureProblems({
    stripeSpec,
    balanceSpec: readRepo(BALANCE_SPEC),
  });
  assert.ok(
    problems.some((problem) => problem.includes("merchantDisplayName Frapp")),
    problems.join("; "),
  );
});

test("restoring a Frapp disabled-reason fixture fails", () => {
  const balanceSpec = readRepo(BALANCE_SPEC).replace(
    "installed Signet build",
    "installed Frapp build",
  );
  const problems = paymentFixtureProblems({
    stripeSpec: readRepo(STRIPE_SPEC),
    balanceSpec,
  });
  assert.ok(
    problems.some((problem) => problem.includes("installed Frapp build")),
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

test("a third Frapp PaymentSheet spec fails the walk", () => {
  const files = [
    { rel: STRIPE_SPEC, source: 'merchantDisplayName: "Signet"' },
    {
      rel: "apps/mobile/lib/payments/extra.spec.ts",
      source: 'merchantDisplayName: "Frapp"',
    },
  ];
  assert.deepEqual(
    walkedMerchantProblems(files).filter((problem) => problem.includes("extra")),
    ["apps/mobile/lib/payments/extra.spec.ts:merchantDisplayName Frapp"],
  );
});

test("a third installed-Frapp spec fails the walk", () => {
  const files = [
    { rel: BALANCE_SPEC, source: "installed Signet build" },
    {
      rel: "apps/mobile/components/dues/extra.spec.tsx",
      source: "installed Frapp build",
    },
  ];
  assert.deepEqual(
    walkedInstalledBuildProblems(files).filter((problem) =>
      problem.includes("extra"),
    ),
    ["apps/mobile/components/dues/extra.spec.tsx:installed Frapp build"],
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

test("pointing the fixture walker at landing fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile")',
      'const MOBILE_ROOT = join(REPO_ROOT, "apps/landing")',
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
