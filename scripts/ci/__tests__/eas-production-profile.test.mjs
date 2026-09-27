// Locks the EAS production build profile on the production API.
//
// WHY THIS EXISTS. Launch bar 3 submits from an EAS production build.
// `apps/mobile/eas.json` already points that profile at
// `https://api.frapp.live`. Nothing else in CI notices if a leftover
// sweep or a local edit retargets it at staging, and the next production
// binary would sign first users into the wrong API/DB.
//
// SCOPE. Production target + preview contrast so the two profiles cannot
// be swapped unnoticed, and the iOS build image every profile pins. The home-screen name (`expo.name`) and the Settings
// path are frapp-mobile-copy's (ADR-25 step 2); nothing locks the App Store
// listing name. The binary's permanent identifiers are
// mobile-permanent-identifiers.test.mjs's, which lists them and says where
// each one is decided. This lock doesn't assert extra.eas.projectId or an
// iOS submit block. Do not run eas init.
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

// THE iOS BUILD IMAGE. Apple's TN3187: an app built with the iOS 27 SDK
// has to adopt the UIScene life cycle or it does not launch, and SDK 57's
// prebuild still emits the AppDelegate window. With no `image`, EAS builds
// on `auto`, whose SDK alias EAS moves to a newer Xcode when it ships one
// (it moved `sdk-54` to Xcode 26). So every profile pins an exact Xcode 26
// image until the app adopts scenes. Why, and when it has to move:
// spec/environments/README.md § Mobile (EAS).
export const IOS_BUILD_IMAGE = "macos-tahoe-26.5-xcode-26.6";
const IOS_XCODE_MAJOR = 26;
const EAS_IMAGE_ALIASES = /^(auto|default|latest|sdk-\d+)$/;

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

/** The iOS image a profile builds on, following `extends` as eas.json does. */
export function iosImageOf(eas, profile, seen = new Set()) {
  const config = eas?.build?.[profile];
  if (config == null || typeof config !== "object" || seen.has(profile)) {
    return undefined;
  }
  seen.add(profile);
  const own = config.ios?.image;
  if (own !== undefined) return own;
  return typeof config.extends === "string"
    ? iosImageOf(eas, config.extends, seen)
    : undefined;
}

export function xcodeMajorOf(image) {
  const match = /-xcode-(\d+)(?:\.\d+)*$/.exec(String(image));
  return match ? Number(match[1]) : null;
}

/** Every build profile pins the one exact Xcode 26 image; no alias. */
export function iosImageProblems(eas) {
  const problems = [];
  const profiles = Object.keys(eas?.build ?? {});
  if (profiles.length === 0) problems.push("build must declare its profiles");
  for (const profile of profiles) {
    const image = iosImageOf(eas, profile);
    if (image === undefined) {
      problems.push(`build.${profile}.ios.image must be set, or EAS builds on auto`);
      continue;
    }
    if (EAS_IMAGE_ALIASES.test(String(image))) {
      problems.push(`build.${profile}.ios.image must be an exact image, not the alias ${image}`);
      continue;
    }
    if (xcodeMajorOf(image) !== IOS_XCODE_MAJOR) {
      problems.push(`build.${profile}.ios.image must be an Xcode ${IOS_XCODE_MAJOR} image, not ${image}`);
      continue;
    }
    if (image !== IOS_BUILD_IMAGE) {
      problems.push(`build.${profile}.ios.image must be ${IOS_BUILD_IMAGE}, not ${image}`);
    }
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
  const image = source.match(/^export const IOS_BUILD_IMAGE = "([^"]+)";?$/m);
  if (!image || !/^macos-[a-z]+-\d+(\.\d+)*-xcode-26(\.\d+)*$/.test(image[1])) {
    problems.push("IOS_BUILD_IMAGE must stay an exact Xcode 26 image");
  }
  const major = source.match(/^const IOS_XCODE_MAJOR = (\d+);?$/m);
  if (!major || major[1] !== "26") {
    problems.push("IOS_XCODE_MAJOR must stay 26 until the app adopts UIScene");
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

test("live eas.json pins the iOS build image on every profile", () => {
  const eas = readLiveEas();
  assert.deepEqual(iosImageProblems(eas), []);
  for (const profile of ["development", "preview", "production"]) {
    assert.equal(iosImageOf(eas, profile), IOS_BUILD_IMAGE, profile);
  }
});

test("dropping a profile's iOS image fails", () => {
  const eas = fixtureEas();
  delete eas.build.preview.ios;
  assert.deepEqual(
    iosImageProblems(eas).filter((problem) => problem.includes("build.preview")),
    ["build.preview.ios.image must be set, or EAS builds on auto"],
  );
});

test("an image alias fails", () => {
  for (const alias of ["auto", "latest", "sdk-57", "default"]) {
    const eas = fixtureEas();
    eas.build.production.ios.image = alias;
    assert.ok(
      iosImageProblems(eas).some((problem) => problem.includes(`alias ${alias}`)),
      alias,
    );
  }
});

test("an Xcode 27 image fails", () => {
  const eas = fixtureEas();
  eas.build.production.ios.image = "macos-tahoe-27.0-xcode-27.0";
  assert.ok(
    iosImageProblems(eas).some((problem) => problem.includes("Xcode 26 image")),
    iosImageProblems(eas).join("; "),
  );
});

test("another Xcode 26 image than the pinned one fails", () => {
  const eas = fixtureEas();
  eas.build.development.ios.image = "macos-tahoe-26.4-xcode-26.4";
  assert.ok(
    iosImageProblems(eas).some((problem) => problem.includes(IOS_BUILD_IMAGE)),
    iosImageProblems(eas).join("; "),
  );
});

test("a profile inherits its iOS image through extends", () => {
  const eas = fixtureEas();
  delete eas.build.preview.ios;
  eas.build.preview.extends = "production";
  assert.equal(iosImageOf(eas, "preview"), IOS_BUILD_IMAGE);
  assert.deepEqual(iosImageProblems(eas), []);
  eas.build.production.extends = "preview";
  delete eas.build.production.ios;
  assert.equal(iosImageOf(eas, "production"), undefined);
});

test("xcodeMajorOf reads the Xcode major off an image name", () => {
  assert.equal(xcodeMajorOf(IOS_BUILD_IMAGE), 26);
  assert.equal(xcodeMajorOf("macos-sequoia-15.6-xcode-16.4"), 16);
  assert.equal(xcodeMajorOf("sdk-57"), null);
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

test("moving IOS_BUILD_IMAGE to an Xcode 27 image fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      `export const IOS_BUILD_IMAGE = "${IOS_BUILD_IMAGE}"`,
      'export const IOS_BUILD_IMAGE = "macos-tahoe-27.0-xcode-27.0"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("IOS_BUILD_IMAGE")),
    problems.join("; "),
  );
});

test("raising IOS_XCODE_MAJOR fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      "const IOS_XCODE_MAJOR = 26;",
      "const IOS_XCODE_MAJOR = 27;",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("IOS_XCODE_MAJOR")),
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
