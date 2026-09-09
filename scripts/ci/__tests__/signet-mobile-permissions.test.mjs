// Locks mobile OS permission dialogs and Expo Go pay/push copy on Signet.
//
// WHY THIS EXISTS. The three app.json permission strings, the Expo Go
// pay/push sentences, and the PaymentSheet merchant default are already
// Signet. A leftover sweep can put Frapp back in the OS dialog, add a
// fourth *Permission string on app.config.js the first lock would miss,
// drop a prompt so the hardcoded list still passes, or treat Settings →
// Frapp / the store display name as in-scope. #1952.
//
// SCOPE. String-valued *Permission prompts under apps/mobile, the
// stripeUnavailableReason / pushUnavailableReason definitions, and the
// dues merchantDisplayName default. Leave app.json name / scheme /
// bundle id / Settings → Frapp on 1829. Do not add a must-exist assert
// for the EAS project id. Do not run eas init. Do not walk landing.
// Skip spec fixtures (1968 retires the Frapp pay-copy ones).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile");
const LOCK = fileURLToPath(import.meta.url);

const APP_JSON = "apps/mobile/app.json";
const STRIPE = "apps/mobile/lib/payments/stripe.ts";
const PUSH = "apps/mobile/lib/notifications/push.ts";
const DUES = "apps/mobile/app/(tabs)/dues.tsx";

/** Current string-valued OS permission prompts. A deleted prompt must fail. */
const MIN_PERMISSION_STRINGS = 3;

const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", "coverage"]);
const SOURCE_EXT = /\.(?:json|js|ts|tsx)$/;

const PERMISSIONS = [
  "Signet uses the camera to scan the check-in code at chapter events.",
  "Signet uses your photo library so you can choose a profile photo or attach an image.",
  "Signet confirms you are inside a chapter study zone while you track study hours, and that you are at the event when you scan a check-in code.",
];

const EXPECTED_SITES = [APP_JSON, DUES, PUSH, STRIPE].sort();

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function literal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkMobile(dir = MOBILE_ROOT) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkMobile(path));
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
    if (/\.spec\./.test(entry.name)) continue;
    out.push(path);
  }
  return out;
}

// JSON-quoted keys in app.json, and the unquoted / single-quoted JS
// forms Expo config files actually use. Boolean `false` is not a prompt.
export function collectPermissionStrings(source) {
  const found = [];
  const pattern =
    /(?:^|[\s,{])(?:"([A-Za-z]+Permission)"|([A-Za-z]+Permission)):\s*["']([^"']+)["']/gm;
  for (const match of source.matchAll(pattern)) {
    found.push({ key: match[1] || match[2], value: match[3] });
  }
  return found;
}

export function isPermissionCopySite(source) {
  return (
    collectPermissionStrings(source).length > 0 ||
    /export function stripeUnavailableReason/.test(source) ||
    /export function pushUnavailableReason/.test(source) ||
    /merchantDisplayName:\s*chapterName \?\?/.test(source)
  );
}

export function permissionCopySites(root = MOBILE_ROOT) {
  return walkMobile(root)
    .filter((path) => isPermissionCopySite(readFileSync(path, "utf8")))
    .map((path) => relative(REPO_ROOT, path).replaceAll("\\", "/"))
    .sort();
}

export function walkedPermissionCopyProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    for (const prompt of collectPermissionStrings(source)) {
      if (!/Signet/.test(prompt.value) || /\bFrapp\b/.test(prompt.value)) {
        problems.push(`${rel}:${prompt.key}`);
      }
    }
  }
  return problems;
}

function livePermissionFiles() {
  return walkMobile().map((path) => ({
    rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));
}

export function mobilePermissionLockProblems({ appJson, stripe, push, dues }) {
  const problems = [];
  const prompts = collectPermissionStrings(appJson);
  if (prompts.length < MIN_PERMISSION_STRINGS) {
    problems.push("must keep at least three string-valued *Permission prompts");
  }
  for (const key of [
    "cameraPermission",
    "photosPermission",
    "locationWhenInUsePermission",
  ]) {
    if (!prompts.some((prompt) => prompt.key === key)) {
      problems.push(`must keep ${key}`);
    }
  }
  for (const sentence of PERMISSIONS) {
    if (!prompts.some((prompt) => prompt.value === sentence)) {
      problems.push(`missing permission sentence: ${sentence}`);
    }
  }
  for (const prompt of prompts) {
    if (!/Signet/.test(prompt.value)) {
      problems.push(`${prompt.key} must name Signet`);
    }
    if (/\bFrapp\b/.test(prompt.value)) {
      problems.push(`${prompt.key} must not name Frapp`);
    }
  }

  if (!/export function stripeUnavailableReason/.test(stripe)) {
    problems.push("must keep stripeUnavailableReason");
  }
  if (!/installed Signet build/.test(stripe)) {
    problems.push("stripeUnavailableReason must name the installed Signet build");
  }
  if (!/Signet mobile app/.test(stripe)) {
    problems.push("stripeUnavailableReason must name the Signet mobile app");
  }
  if (/\bFrapp\b/.test(stripe)) {
    problems.push("stripe.ts must not name Frapp");
  }

  if (!/export function pushUnavailableReason/.test(push)) {
    problems.push("must keep pushUnavailableReason");
  }
  if (!/installed Signet build/.test(push)) {
    problems.push("pushUnavailableReason must name the installed Signet build");
  }
  if (/\bFrapp\b/.test(push)) {
    problems.push("push.ts must not name Frapp");
  }

  if (!/merchantDisplayName:\s*chapterName \?\? "Signet"/.test(dues)) {
    problems.push('merchantDisplayName default must be chapterName ?? "Signet"');
  }
  if (/merchantDisplayName:\s*chapterName \?\? "Frapp"/.test(dues)) {
    problems.push("merchantDisplayName default must not be Frapp");
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const floor = source.match(/^const MIN_PERMISSION_STRINGS = (\d+);?$/m);
  if (!floor || floor[1] !== "3") {
    problems.push("MIN_PERMISSION_STRINGS must stay 3");
  }
  const mobileRoot = source.match(
    /^const MOBILE_ROOT = join\(REPO_ROOT, "([^"]+)"\);?$/m,
  );
  if (!mobileRoot || mobileRoot[1] !== "apps/mobile") {
    problems.push("walker must stay on apps/mobile");
  }
  if (mobileRoot && mobileRoot[1].startsWith("apps/landing")) {
    problems.push("must not walk apps/landing");
  }
  const appJson = source.match(/^const APP_JSON = "([^"]+)";?$/m);
  if (!appJson || appJson[1] !== "apps/mobile/app.json") {
    problems.push("APP_JSON must stay apps/mobile/app.json");
  }
  if (!/\[A-Za-z\]\+Permission/.test(source)) {
    problems.push("must collect any *Permission string, not only the three known keys");
  }
  if (!/\(\?:"\(\[A-Za-z\]\+Permission\)"\|/.test(source)) {
    problems.push("must collect unquoted JS *Permission keys");
  }
  if (!/\\\.spec\\\./.test(source)) {
    problems.push("walker must skip spec fixtures");
  }
  if (/assert\.[^\n]*extra\.eas\.projectId/.test(source)) {
    problems.push("must not require extra.eas.projectId");
  }
  return problems;
}

test("OS permission, Expo Go, and merchant copy stay Signet", () => {
  assert.deepEqual(
    mobilePermissionLockProblems({
      appJson: readRepo(APP_JSON),
      stripe: readRepo(STRIPE),
      push: readRepo(PUSH),
      dues: readRepo(DUES),
    }),
    [],
  );
  assert.deepEqual(permissionCopySites(), EXPECTED_SITES);
  assert.deepEqual(walkedPermissionCopyProblems(livePermissionFiles()), []);
});

test("putting Frapp in a camera permission string fails", () => {
  const problems = mobilePermissionLockProblems({
    appJson: readRepo(APP_JSON).replace(
      "Signet uses the camera",
      "Frapp uses the camera",
    ),
    stripe: readRepo(STRIPE),
    push: readRepo(PUSH),
    dues: readRepo(DUES),
  });
  assert.ok(
    problems.some((problem) => problem.includes("cameraPermission")),
    problems.join("; "),
  );
});

test("dropping photosPermission fails", () => {
  const problems = mobilePermissionLockProblems({
    appJson: readRepo(APP_JSON).replace(
      '"photosPermission": "Signet uses your photo library so you can choose a profile photo or attach an image."',
      '"photosPermission": false',
    ),
    stripe: readRepo(STRIPE),
    push: readRepo(PUSH),
    dues: readRepo(DUES),
  });
  assert.ok(
    problems.some((problem) => problem.includes("photosPermission")),
    problems.join("; "),
  );
});

test("a third JS-style *Permission site fails the walk", () => {
  const rel = "apps/mobile/app.config.js";
  const source =
    'module.exports = { cameraPermission: "Frapp uses the camera." };\n';
  assert.equal(isPermissionCopySite(source), true);
  assert.deepEqual(walkedPermissionCopyProblems([{ rel, source }]), [
    `${rel}:cameraPermission`,
  ]);
});

test("turning a disabled microphonePermission into a Frapp prompt fails", () => {
  const problems = mobilePermissionLockProblems({
    appJson: readRepo(APP_JSON).replace(
      '"microphonePermission": false',
      '"microphonePermission": "Frapp uses the microphone."',
    ),
    stripe: readRepo(STRIPE),
    push: readRepo(PUSH),
    dues: readRepo(DUES),
  });
  assert.ok(
    problems.some((problem) => problem.includes("microphonePermission")),
    problems.join("; "),
  );
});

test("putting Frapp back in stripeUnavailableReason fails", () => {
  const problems = mobilePermissionLockProblems({
    appJson: readRepo(APP_JSON),
    stripe: readRepo(STRIPE).replaceAll("Signet", "Frapp"),
    push: readRepo(PUSH),
    dues: readRepo(DUES),
  });
  assert.ok(
    problems.some((problem) => /stripe|Frapp/.test(problem)),
    problems.join("; "),
  );
});

test("dropping stripeUnavailableReason fails", () => {
  const problems = mobilePermissionLockProblems({
    appJson: readRepo(APP_JSON),
    stripe: readRepo(STRIPE).replaceAll(
      "stripeUnavailableReason",
      "payUnavailableReason",
    ),
    push: readRepo(PUSH),
    dues: readRepo(DUES),
  });
  assert.ok(
    problems.some((problem) => problem.includes("stripeUnavailableReason")),
    problems.join("; "),
  );
});

test("pinning the merchant default to Frapp fails", () => {
  const problems = mobilePermissionLockProblems({
    appJson: readRepo(APP_JSON),
    stripe: readRepo(STRIPE),
    push: readRepo(PUSH),
    dues: readRepo(DUES).replace(
      'merchantDisplayName: chapterName ?? "Signet"',
      'merchantDisplayName: chapterName ?? "Frapp"',
    ),
  });
  assert.ok(
    problems.some((problem) => problem.includes("must not be Frapp")),
    problems.join("; "),
  );
});

test("walker stays on apps/mobile and keeps the prompt floor", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("pointing the walker at landing fails", () => {
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

test("dropping the unquoted JS collector fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replaceAll(
      '(?:"([A-Za-z]+Permission)"|([A-Za-z]+Permission))',
      '"([A-Za-z]+Permission)"',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("unquoted JS")),
    problems.join("; "),
  );
});

test("dropping MIN_PERMISSION_STRINGS below 3 fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      "const MIN_PERMISSION_STRINGS = 3",
      "const MIN_PERMISSION_STRINGS = 1",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("MIN_PERMISSION_STRINGS")),
    problems.join("; "),
  );
});

test("an extra.eas.projectId must-exist assert fails", () => {
  const prefix = "assert.ok(json.expo.";
  const suffix = "extra.eas.projectId);";
  const problems = lockSelfProblems(
    `${readFileSync(LOCK, "utf8")}\n${prefix}${suffix}\n`,
  );
  assert.ok(
    problems.some((problem) => problem.includes("extra.eas.projectId")),
    problems.join("; "),
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(LOCK, "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
