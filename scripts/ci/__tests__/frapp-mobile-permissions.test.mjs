// Locks mobile OS permission dialogs and Expo Go pay/push copy on Frapp.
//
// WHY THIS EXISTS. ADR-25 names the product Frapp, and step 2 moved the
// mobile binary to it: the app.json permission strings, the Expo Go
// pay/push sentences, and the PaymentSheet merchant default. A leftover
// sweep can put Signet back in the OS dialog, or add a *Permission string
// on app.config.js the first lock would miss. This lock was
// signet-mobile-permissions (#1952), which pinned the same sites on Signet
// until ADR-25 reversed the name; "Signet" now names only the design
// system, never a string a member reads.
//
// WHICH PROMPTS EXIST IS NOT THIS LOCK'S (#2343). It used to keep a prompt
// floor, a must-keep key list and the exact sentences, while
// apps/mobile/app.config.spec.ts kept its own option roster. The two
// contradicted each other once (#2296 removed photosPermission and this
// floor went red), and both read app.json, so neither saw a plugin default
// the build ships for an omitted option. The roster now has one home,
// scripts/check-mobile-native-declarations.mjs, which reads the Info.plist
// and AndroidManifest the config plugins actually produce and pins each
// purpose string exactly. This lock asserts only its own concern: whatever
// prompt strings exist name Frapp, never Signet.
//
// SCOPE. String-valued *Permission prompts under apps/mobile, the
// stripeUnavailableReason / pushUnavailableReason definitions, and the
// dues merchantDisplayName default. The ban on Signet anywhere else in the
// mobile surface's copy, stripe.ts and push.ts included, and the
// Settings → <expo.name> recovery paths are frapp-mobile-copy's: its walk
// exempts a design-system note on its own comment line, which a file-wide
// ban here would not.
// app.json's permanent identifiers are not copy and not this lock's:
// mobile-permanent-identifiers.test.mjs lists and pins them. Do not run
// eas init.
// Do not walk landing. Skip spec fixtures (frapp-mobile-copy pins the
// payment ones).

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

const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", "coverage"]);
const SOURCE_EXT = /\.(?:json|js|ts|tsx)$/;

const EXPECTED_SITES = [APP_JSON, DUES, PUSH, STRIPE].sort();

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
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
      if (!/\bFrapp\b/.test(prompt.value) || /\bSignet\b/.test(prompt.value)) {
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

// The prompt strings themselves, app.json's included, are the walk's
// (walkedPermissionCopyProblems): one predicate, one place.
export function mobilePermissionLockProblems({ stripe, push, dues }) {
  const problems = [];
  if (!/export function stripeUnavailableReason/.test(stripe)) {
    problems.push("must keep stripeUnavailableReason");
  }
  if (!/installed Frapp build/.test(stripe)) {
    problems.push("stripeUnavailableReason must name the installed Frapp build");
  }
  if (!/Frapp mobile app/.test(stripe)) {
    problems.push("stripeUnavailableReason must name the Frapp mobile app");
  }

  if (!/export function pushUnavailableReason/.test(push)) {
    problems.push("must keep pushUnavailableReason");
  }
  if (!/installed Frapp build/.test(push)) {
    problems.push("pushUnavailableReason must name the installed Frapp build");
  }

  if (!/merchantDisplayName:\s*chapterName \?\? "Frapp"/.test(dues)) {
    problems.push('merchantDisplayName default must be chapterName ?? "Frapp"');
  }
  if (/merchantDisplayName:\s*chapterName \?\? "Signet"/.test(dues)) {
    problems.push("merchantDisplayName default must not be Signet");
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
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
    problems.push("must collect any *Permission string, not only the known keys");
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

test("OS permission, Expo Go, and merchant copy say Frapp", () => {
  assert.deepEqual(
    mobilePermissionLockProblems({
        stripe: readRepo(STRIPE),
      push: readRepo(PUSH),
      dues: readRepo(DUES),
    }),
    [],
  );
  assert.deepEqual(permissionCopySites(), EXPECTED_SITES);
  assert.deepEqual(walkedPermissionCopyProblems(livePermissionFiles()), []);
});

test("putting Signet in a camera permission string fails", () => {
  const problems = walkedPermissionCopyProblems([
    {
      rel: APP_JSON,
      source: readRepo(APP_JSON).replace("Frapp uses the camera", "Signet uses the camera"),
    },
  ]);
  assert.ok(
    problems.some((problem) => problem.includes("cameraPermission")),
    problems.join("; "),
  );
});

test("each half of the naming rule fails on its own", () => {
  // Swapping Frapp for Signet trips both halves at once, so pin each alone.
  const rel = "apps/mobile/app.config.js";
  for (const value of ["Frapp (formerly Signet) uses the camera.", "Allow the app to use the camera."]) {
    const source = `module.exports = { cameraPermission: "${value}" };\n`;
    assert.deepEqual(walkedPermissionCopyProblems([{ rel, source }]), [`${rel}:cameraPermission`], value);
  }
});

test("a third JS-style *Permission site fails the walk", () => {
  const rel = "apps/mobile/app.config.js";
  const source =
    'module.exports = { cameraPermission: "Signet uses the camera." };\n';
  assert.equal(isPermissionCopySite(source), true);
  assert.deepEqual(walkedPermissionCopyProblems([{ rel, source }]), [
    `${rel}:cameraPermission`,
  ]);
});

test("turning a disabled microphonePermission into a Signet prompt fails", () => {
  const problems = walkedPermissionCopyProblems([
    {
      rel: APP_JSON,
      source: readRepo(APP_JSON).replace(
        '"microphonePermission": false',
        '"microphonePermission": "Signet uses the microphone."',
      ),
    },
  ]);
  assert.ok(
    problems.some((problem) => problem.includes("microphonePermission")),
    problems.join("; "),
  );
});

test("putting Signet back in stripeUnavailableReason fails", () => {
  const problems = mobilePermissionLockProblems({
    stripe: readRepo(STRIPE).replaceAll("Frapp", "Signet"),
    push: readRepo(PUSH),
    dues: readRepo(DUES),
  });
  assert.ok(
    problems.some((problem) => problem.includes("installed Frapp build")),
    problems.join("; "),
  );
});

test("dropping stripeUnavailableReason fails", () => {
  const problems = mobilePermissionLockProblems({
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

test("pinning the merchant default to Signet fails", () => {
  const problems = mobilePermissionLockProblems({
    stripe: readRepo(STRIPE),
    push: readRepo(PUSH),
    dues: readRepo(DUES).replace(
      'merchantDisplayName: chapterName ?? "Frapp"',
      'merchantDisplayName: chapterName ?? "Signet"',
    ),
  });
  assert.ok(
    problems.some((problem) => problem.includes("must not be Signet")),
    problems.join("; "),
  );
});

test("walker stays on apps/mobile", () => {
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
