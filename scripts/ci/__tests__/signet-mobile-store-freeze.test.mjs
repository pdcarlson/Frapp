// Locks mobile store identity on Frapp until the store-name decision.
//
// WHY THIS EXISTS. Launch bar 3 submits from an EAS production build
// whose store identity is still Frapp: app.json name / slug / scheme /
// live.frapp.mobile, and the store README Identity table. A leftover
// sweep can rename the binary to Signet before App Store Connect / Play
// Console exist, and the OS Settings label would no longer match the
// listing. This lock is the freeze, not the rename. The store-name
// leftover (1829) is what replaces this file after the decision.
//
// SCOPE. Identity fields only. Leave permission strings on 1952, the
// EAS production API target on 1965, landing freeze on 1961, and the
// EAS project leftover on 938. Do not require extra.eas.projectId.
// Do not run eas init.
//
// The first lock imported STORE_NAME into every assert, so rewriting
// the const and app.json together to Signet would still pass. Pin the
// assignment lines. Walk apps/ for a second app.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const APPS_ROOT = join(REPO_ROOT, "apps");
const APP_JSON = "apps/mobile/app.json";
const STORE_README = "apps/mobile/store/README.md";
const APP_CONFIG = "apps/mobile/app.config.js";

/** One app.json, the mobile binary identity. A second file is drift. */
const MIN_APP_JSON = 1;
const EXPECTED_APP_JSON = [APP_JSON];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);

export const STORE_NAME = "Frapp";
export const STORE_SLUG = "frapp";
export const STORE_SCHEME = "frapp";
export const STORE_BUNDLE_ID = "live.frapp.mobile";

export function parseAppJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${APP_JSON} is not valid JSON` };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: `${APP_JSON} root is not an object` };
  }
  return { ok: true, app: parsed };
}

export function storeIdentityProblems(app) {
  const expo = app?.expo;
  const problems = [];
  if (expo == null || typeof expo !== "object" || Array.isArray(expo)) {
    return ["expo must be an object"];
  }
  if (expo.name !== STORE_NAME) {
    problems.push(`expo.name must be ${STORE_NAME}`);
  }
  if (expo.slug !== STORE_SLUG) {
    problems.push(`expo.slug must be ${STORE_SLUG}`);
  }
  if (expo.scheme !== STORE_SCHEME) {
    problems.push(`expo.scheme must be ${STORE_SCHEME}`);
  }
  if (expo.ios?.bundleIdentifier !== STORE_BUNDLE_ID) {
    problems.push(`expo.ios.bundleIdentifier must be ${STORE_BUNDLE_ID}`);
  }
  if (expo.android?.package !== STORE_BUNDLE_ID) {
    problems.push(`expo.android.package must be ${STORE_BUNDLE_ID}`);
  }
  const displayName = expo.ios?.infoPlist?.CFBundleDisplayName;
  if (displayName != null && displayName !== STORE_NAME) {
    problems.push(
      "expo.ios.infoPlist.CFBundleDisplayName must be absent or Frapp",
    );
  }
  const androidLabel = expo.android?.label;
  if (androidLabel != null && androidLabel !== STORE_NAME) {
    problems.push("expo.android.label must be absent or Frapp");
  }
  return problems;
}

export function walkAppJson(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkAppJson(path));
      continue;
    }
    if (entry.isFile() && entry.name === "app.json") out.push(path);
  }
  return out;
}

export function appJsonSites(files) {
  return files
    .map((file) => file.rel)
    .sort();
}

export function walkedAppJsonProblems(files) {
  const problems = [];
  const sites = appJsonSites(files);
  if (sites.length < MIN_APP_JSON) {
    problems.push("apps must keep the mobile app.json");
  }
  for (const site of sites) {
    if (!EXPECTED_APP_JSON.includes(site)) problems.push(`${site}:unexpected`);
  }
  for (const expected of EXPECTED_APP_JSON) {
    if (!sites.includes(expected)) problems.push(`${expected}:missing`);
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const name = source.match(/^export const STORE_NAME = "([^"]+)";?$/m);
  if (!name || name[1] !== "Frapp") {
    problems.push("STORE_NAME must stay Frapp");
  }
  const slug = source.match(/^export const STORE_SLUG = "([^"]+)";?$/m);
  if (!slug || slug[1] !== "frapp") {
    problems.push("STORE_SLUG must stay frapp");
  }
  const scheme = source.match(/^export const STORE_SCHEME = "([^"]+)";?$/m);
  if (!scheme || scheme[1] !== "frapp") {
    problems.push("STORE_SCHEME must stay frapp");
  }
  const bundle = source.match(/^export const STORE_BUNDLE_ID = "([^"]+)";?$/m);
  if (!bundle || bundle[1] !== "live.frapp.mobile") {
    problems.push("STORE_BUNDLE_ID must stay live.frapp.mobile");
  }
  const appPath = source.match(/^const APP_JSON = "([^"]+)";?$/m);
  if (!appPath || appPath[1] !== "apps/mobile/app.json") {
    problems.push("must read apps/mobile/app.json");
  }
  if (appPath && appPath[1].startsWith("apps/landing")) {
    problems.push("must not read apps/landing");
  }
  const readme = source.match(/^const STORE_README = "([^"]+)";?$/m);
  if (!readme || readme[1] !== "apps/mobile/store/README.md") {
    problems.push("must read apps/mobile/store/README.md");
  }
  const config = source.match(/^const APP_CONFIG = "([^"]+)";?$/m);
  if (!config || config[1] !== "apps/mobile/app.config.js") {
    problems.push("must read apps/mobile/app.config.js");
  }
  const appsRoot = source.match(/^const APPS_ROOT = join\(REPO_ROOT, "([^"]+)"\);?$/m);
  if (!appsRoot || appsRoot[1] !== "apps") {
    problems.push("walker must stay on apps");
  }
  if (appsRoot && appsRoot[1].startsWith("apps/landing")) {
    problems.push("must not walk apps/landing only");
  }
  const floor = source.match(/^const MIN_APP_JSON = (\d+);?$/m);
  if (!floor || floor[1] !== "1") {
    problems.push("MIN_APP_JSON must stay 1");
  }
  if (/assert\.(ok|equal|deepEqual|match)\([^\n]*extra\.eas\.projectId/.test(source)) {
    problems.push("must not require extra.eas.projectId");
  }
  return problems;
}

function liveAppJsonFiles() {
  return walkAppJson(APPS_ROOT).map((path) => ({
    rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
  }));
}

function readLiveApp() {
  const parsed = parseAppJson(readFileSync(join(REPO_ROOT, APP_JSON), "utf8"));
  assert.equal(parsed.ok, true, parsed.reason);
  return parsed.app;
}

function fixtureApp() {
  const parsed = parseAppJson(readFileSync(join(REPO_ROOT, APP_JSON), "utf8"));
  assert.equal(parsed.ok, true, parsed.reason);
  return structuredClone(parsed.app);
}

test("live app.json store identity stays Frapp", () => {
  const problems = storeIdentityProblems(readLiveApp());
  assert.deepEqual(problems, []);
  assert.deepEqual(appJsonSites(liveAppJsonFiles()), EXPECTED_APP_JSON);
  assert.deepEqual(walkedAppJsonProblems(liveAppJsonFiles()), []);
});

test("renaming the binary to Signet fails", () => {
  const app = fixtureApp();
  app.expo.name = "Signet";
  const problems = storeIdentityProblems(app);
  assert.ok(
    problems.some((problem) => problem.includes("expo.name")),
    problems.join("; "),
  );
});

test("changing the slug or scheme fails", () => {
  const slug = fixtureApp();
  slug.expo.slug = "signet";
  assert.ok(
    storeIdentityProblems(slug).some((problem) => problem.includes("expo.slug")),
  );
  const scheme = fixtureApp();
  scheme.expo.scheme = "signet";
  assert.ok(
    storeIdentityProblems(scheme).some((problem) =>
      problem.includes("expo.scheme"),
    ),
  );
});

test("changing the bundle id fails", () => {
  const app = fixtureApp();
  app.expo.ios.bundleIdentifier = "live.signet.mobile";
  app.expo.android.package = "live.signet.mobile";
  const problems = storeIdentityProblems(app);
  assert.ok(
    problems.some((problem) => problem.includes("bundleIdentifier")),
    problems.join("; "),
  );
  assert.ok(
    problems.some((problem) => problem.includes("android.package")),
    problems.join("; "),
  );
});

test("an iOS or Android display-name override to Signet fails", () => {
  const ios = fixtureApp();
  ios.expo.ios.infoPlist.CFBundleDisplayName = "Signet";
  assert.ok(
    storeIdentityProblems(ios).some((problem) =>
      problem.includes("CFBundleDisplayName"),
    ),
  );
  const android = fixtureApp();
  android.expo.android.label = "Signet";
  assert.ok(
    storeIdentityProblems(android).some((problem) =>
      problem.includes("android.label"),
    ),
  );
});

test("app.config.js does not override store identity", () => {
  const source = readFileSync(join(REPO_ROOT, APP_CONFIG), "utf8");
  assert.doesNotMatch(source, /CFBundleDisplayName/);
  assert.doesNotMatch(source, /\bname:\s*["']Signet["']/);
  assert.doesNotMatch(source, /\blabel:\s*["']Signet["']/);
  assert.doesNotMatch(source, /bundleIdentifier:\s*["']live\.signet/);
});

test("store README identity table stays Frapp", () => {
  const readme = readFileSync(join(REPO_ROOT, STORE_README), "utf8");
  assert.match(readme, /\|\s*Name\s*\|\s*Frapp\s*\|/);
  assert.match(
    readme,
    /\|\s*Bundle id \/ package\s*\|\s*`live\.frapp\.mobile`\s*\|/,
  );
  assert.doesNotMatch(
    readme,
    /\|\s*Name\s*\|\s*Signet\s*\|/,
    `${STORE_README} Identity Name must stay Frapp until the store-name leftover`,
  );
});

test("store identity ignores an EAS projectId field", () => {
  const app = fixtureApp();
  app.expo.extra = { eas: { projectId: "00000000-0000-0000-0000-000000000000" } };
  assert.deepEqual(storeIdentityProblems(app), []);
});

test("invalid JSON is a parse failure, not a pass", () => {
  const parsed = parseAppJson("{");
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /not valid JSON/);
});

test("a second app.json site fails the walk", () => {
  const files = [{ rel: APP_JSON }, { rel: "apps/landing/app.json" }];
  assert.deepEqual(
    walkedAppJsonProblems(files).filter((problem) => problem.includes("landing")),
    ["apps/landing/app.json:unexpected"],
  );
});

test("lock pins the store-name assignment and refuses a projectId require", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("rewriting STORE_NAME to Signet fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'export const STORE_NAME = "Frapp"',
      'export const STORE_NAME = "Signet"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("STORE_NAME")),
    problems.join("; "),
  );
});

test("rewriting STORE_BUNDLE_ID to live.signet.mobile fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'export const STORE_BUNDLE_ID = "live.frapp.mobile"',
      'export const STORE_BUNDLE_ID = "live.signet.mobile"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("live.frapp.mobile")),
    problems.join("; "),
  );
});

test("pointing the reader at landing fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const APP_JSON = "apps/mobile/app.json"',
      'const APP_JSON = "apps/landing/app.json"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/landing")),
    problems.join("; "),
  );
});

test("pointing the walker at landing fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const APPS_ROOT = join(REPO_ROOT, "apps")',
      'const APPS_ROOT = join(REPO_ROOT, "apps/landing")',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/landing")),
    problems.join("; "),
  );
});

test("dropping the app.json floor fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      "const MIN_APP_JSON = 1",
      "const MIN_APP_JSON = 0",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("MIN_APP_JSON")),
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
