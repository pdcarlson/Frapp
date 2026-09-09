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
// path on their own leftover. Do not require extra.eas.projectId. Do not
// require an iOS submit block. Do not run eas init.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EAS_JSON = "apps/mobile/eas.json";

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

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
