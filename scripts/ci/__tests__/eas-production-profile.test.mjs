// Locks the EAS production build profile on the production API.
//
// WHY THIS EXISTS. Launch bar 3 submits from an EAS production build.
// `apps/mobile/eas.json` already points that profile at
// `https://api.frapp.live`. Nothing else in CI notices if a leftover
// sweep or a local edit retargets it at staging, and the next production
// binary would sign first users into the wrong API/DB.
//
// SCOPE. Production target + preview contrast so the two profiles cannot
// be swapped unnoticed. Leave store-name / scheme / bundle id / Settings
// path on their own leftover (1829). EAS project leftover stays on 938.
// Do not require extra.eas.projectId. Do not require an iOS submit block.
// Do not run eas init.
//
// The first lock imported PRODUCTION_API_URL into every assert, so
// rewriting the const and eas.json together to the staging host would
// still pass. Pin the assignment lines. Walk apps/ for a second eas.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const APPS_ROOT = join(REPO_ROOT, "apps");
const EAS_JSON = "apps/mobile/eas.json";

/** One eas.json, the mobile production target. A second file is drift. */
const MIN_EAS_JSON = 1;
const EXPECTED_EAS_JSON = [EAS_JSON];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);

export const PRODUCTION_API_URL = "https://api.frapp.live";
export const PREVIEW_API_URL = "https://api-staging.frapp.live";
export const PRODUCTION_SENTRY_ENV = "production";
export const ANDROID_SUBMIT_TRACK = "internal";

export function parseEasJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${EAS_JSON} is not valid JSON` };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: `${EAS_JSON} root is not an object` };
  }
  return { ok: true, eas: parsed };
}

function envOf(eas, profile) {
  const env = eas?.build?.[profile]?.env;
  if (env == null || typeof env !== "object" || Array.isArray(env)) {
    return null;
  }
  return env;
}

/**
 * Exact production-target contract. Missing keys fail; comments cannot
 * satisfy a JSON parse.
 */
export function productionTargetProblems(eas) {
  const problems = [];
  if (eas?.build?.production?.environment !== "production") {
    problems.push("build.production.environment must be production");
  }
  const productionEnv = envOf(eas, "production");
  if (productionEnv == null) {
    problems.push("build.production.env must be an object");
  } else {
    if (productionEnv.EXPO_PUBLIC_API_URL !== PRODUCTION_API_URL) {
      problems.push(
        `build.production.env.EXPO_PUBLIC_API_URL must be ${PRODUCTION_API_URL}`,
      );
    }
    if (productionEnv.EXPO_PUBLIC_SENTRY_ENVIRONMENT !== PRODUCTION_SENTRY_ENV) {
      problems.push(
        "build.production.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT must be production",
      );
    }
  }
  if (eas?.submit?.production?.android?.track !== ANDROID_SUBMIT_TRACK) {
    problems.push("submit.production.android.track must be internal");
  }
  const previewEnv = envOf(eas, "preview");
  if (previewEnv == null) {
    problems.push("build.preview.env must be an object");
  } else if (previewEnv.EXPO_PUBLIC_API_URL !== PREVIEW_API_URL) {
    problems.push(
      `build.preview.env.EXPO_PUBLIC_API_URL must stay ${PREVIEW_API_URL}`,
    );
  }
  return problems;
}

export function walkEasJson(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkEasJson(path));
      continue;
    }
    if (entry.isFile() && entry.name === "eas.json") out.push(path);
  }
  return out;
}

export function easJsonSites(files) {
  return files
    .map((file) => file.rel)
    .sort();
}

export function walkedEasJsonProblems(files) {
  const problems = [];
  const sites = easJsonSites(files);
  if (sites.length < MIN_EAS_JSON) {
    problems.push("apps must keep the mobile eas.json");
  }
  for (const site of sites) {
    if (!EXPECTED_EAS_JSON.includes(site)) problems.push(`${site}:unexpected`);
  }
  for (const expected of EXPECTED_EAS_JSON) {
    if (!sites.includes(expected)) problems.push(`${expected}:missing`);
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const api = source.match(/^export const PRODUCTION_API_URL = "([^"]+)";?$/m);
  if (!api || api[1] !== "https://api.frapp.live") {
    problems.push("PRODUCTION_API_URL must stay https://api.frapp.live");
  }
  const preview = source.match(/^export const PREVIEW_API_URL = "([^"]+)";?$/m);
  if (!preview || preview[1] !== "https://api-staging.frapp.live") {
    problems.push("PREVIEW_API_URL must stay https://api-staging.frapp.live");
  }
  const sentry = source.match(/^export const PRODUCTION_SENTRY_ENV = "([^"]+)";?$/m);
  if (!sentry || sentry[1] !== "production") {
    problems.push("PRODUCTION_SENTRY_ENV must stay production");
  }
  const track = source.match(/^export const ANDROID_SUBMIT_TRACK = "([^"]+)";?$/m);
  if (!track || track[1] !== "internal") {
    problems.push("ANDROID_SUBMIT_TRACK must stay internal");
  }
  const easPath = source.match(/^const EAS_JSON = "([^"]+)";?$/m);
  if (!easPath || easPath[1] !== "apps/mobile/eas.json") {
    problems.push("must read apps/mobile/eas.json");
  }
  if (easPath && easPath[1].startsWith("apps/landing")) {
    problems.push("must not read apps/landing");
  }
  const appsRoot = source.match(/^const APPS_ROOT = join\(REPO_ROOT, "([^"]+)"\);?$/m);
  if (!appsRoot || appsRoot[1] !== "apps") {
    problems.push("walker must stay on apps");
  }
  if (appsRoot && appsRoot[1].startsWith("apps/landing")) {
    problems.push("must not walk apps/landing only");
  }
  const floor = source.match(/^const MIN_EAS_JSON = (\d+);?$/m);
  if (!floor || floor[1] !== "1") {
    problems.push("MIN_EAS_JSON must stay 1");
  }
  if (/assert\.(ok|equal|deepEqual|match)\([^\n]*extra\.eas\.projectId/.test(source)) {
    problems.push("must not require extra.eas.projectId");
  }
  if (/assert\.(ok|equal|deepEqual|match)\([^\n]*ascAppId/.test(source)) {
    problems.push("must not require an iOS submit block");
  }
  return problems;
}

function liveEasJsonFiles() {
  return walkEasJson(APPS_ROOT).map((path) => ({
    rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
  }));
}

function readLiveEas() {
  const parsed = parseEasJson(readFileSync(join(REPO_ROOT, EAS_JSON), "utf8"));
  assert.equal(parsed.ok, true, parsed.reason);
  return parsed.eas;
}

function fixtureEas() {
  const parsed = parseEasJson(readFileSync(join(REPO_ROOT, EAS_JSON), "utf8"));
  assert.equal(parsed.ok, true, parsed.reason);
  return structuredClone(parsed.eas);
}

test("live eas.json production profile targets the production API", () => {
  const problems = productionTargetProblems(readLiveEas());
  assert.deepEqual(problems, []);
  assert.deepEqual(easJsonSites(liveEasJsonFiles()), EXPECTED_EAS_JSON);
  assert.deepEqual(walkedEasJsonProblems(liveEasJsonFiles()), []);
});

test("retargeting production at the staging host fails", () => {
  const eas = fixtureEas();
  eas.build.production.env.EXPO_PUBLIC_API_URL = PREVIEW_API_URL;
  const problems = productionTargetProblems(eas);
  assert.ok(
    problems.some((problem) => problem.includes(PRODUCTION_API_URL)),
    problems.join("; "),
  );
});

test("swapping production and preview API URLs fails", () => {
  const eas = fixtureEas();
  eas.build.production.env.EXPO_PUBLIC_API_URL = PREVIEW_API_URL;
  eas.build.preview.env.EXPO_PUBLIC_API_URL = PRODUCTION_API_URL;
  const problems = productionTargetProblems(eas);
  assert.ok(
    problems.some((problem) => problem.includes("build.production")),
    problems.join("; "),
  );
  assert.ok(
    problems.some((problem) => problem.includes("build.preview")),
    problems.join("; "),
  );
});

test("missing production env object fails", () => {
  const eas = fixtureEas();
  delete eas.build.production.env;
  const problems = productionTargetProblems(eas);
  assert.ok(
    problems.some((problem) => problem.includes("build.production.env")),
    problems.join("; "),
  );
});

test("production target ignores projectId and an iOS submit block", () => {
  const eas = fixtureEas();
  eas.submit.production.ios = { ascAppId: "0" };
  eas.extra = { eas: { projectId: "00000000-0000-0000-0000-000000000000" } };
  eas.build.production.env.UNUSED = "ignored";
  assert.deepEqual(productionTargetProblems(eas), []);
});

test("invalid JSON is a parse failure, not a pass", () => {
  const parsed = parseEasJson("{");
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /not valid JSON/);
});

test("retargeting production Sentry at staging fails", () => {
  const eas = fixtureEas();
  eas.build.production.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = "staging";
  const problems = productionTargetProblems(eas);
  assert.ok(
    problems.some((problem) => problem.includes("SENTRY_ENVIRONMENT")),
    problems.join("; "),
  );
});

test("changing the Android submit track off internal fails", () => {
  const eas = fixtureEas();
  eas.submit.production.android.track = "production";
  const problems = productionTargetProblems(eas);
  assert.ok(
    problems.some((problem) => problem.includes("internal")),
    problems.join("; "),
  );
});

test("dropping build.production.environment off production fails", () => {
  const eas = fixtureEas();
  eas.build.production.environment = "preview";
  const problems = productionTargetProblems(eas);
  assert.ok(
    problems.some((problem) => problem.includes("environment must be production")),
    problems.join("; "),
  );
});

test("a second eas.json site fails the walk", () => {
  const files = [
    { rel: EAS_JSON },
    { rel: "apps/landing/eas.json" },
  ];
  assert.deepEqual(
    walkedEasJsonProblems(files).filter((problem) => problem.includes("landing")),
    ["apps/landing/eas.json:unexpected"],
  );
});

test("lock pins the production URL assignment and refuses a projectId require", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("rewriting PRODUCTION_API_URL to the staging host fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'export const PRODUCTION_API_URL = "https://api.frapp.live"',
      'export const PRODUCTION_API_URL = "https://api-staging.frapp.live"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("api.frapp.live")),
    problems.join("; "),
  );
});

test("pointing the reader at landing fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const EAS_JSON = "apps/mobile/eas.json"',
      'const EAS_JSON = "apps/landing/eas.json"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/landing")),
    problems.join("; "),
  );
});

test("requiring extra.eas.projectId fails", () => {
  const plantedAssert = [
    "assert.ok(",
    "eas.extra.eas.projectId);",
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
