// Locks mobile store identity on Frapp until the store-name decision.
//
// WHY THIS EXISTS. Launch bar 3 submits from an EAS production build
// whose store identity is still Frapp: app.json name / slug / scheme /
// live.frapp.mobile, and the store README Identity table. A leftover
// sweep can rename the binary to Signet before App Store Connect / Play
// Console exist, and the OS Settings label would no longer match the
// listing. This lock is the freeze, not the rename. The store-name
// leftover is what replaces this file after the decision.
//
// SCOPE. Identity fields only. Leave permission strings, Settings path,
// and the EAS production API target on their own leftovers. Do not
// require extra.eas.projectId. Do not run eas init.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP_JSON = "apps/mobile/app.json";
const STORE_README = "apps/mobile/store/README.md";

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
  const source = readFileSync(join(REPO_ROOT, "apps/mobile/app.config.js"), "utf8");
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

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
