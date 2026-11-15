// Deploy production's `auto` app release (#2511's first slice): the plan that picks an OTA update
// or a store build per platform (`scripts/ci/plan-mobile-release.mjs`), the workflow that
// publishes the update (`_mobile-update.yml`), and the PR check that keeps native changes behind
// a version bump (`scripts/check-mobile-native-version.mjs`). All three judge with the OTA
// guard's comparison (`compareNativeInputs` in `scripts/eas-update.mjs`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_JSON, APP_CONFIG, LOCKFILE, SHIPPED_BUILDS, compareNativeInputs, packageNameFromLockPath } from "../../eas-update.mjs";
import { main as planMain, planFromCheckout, planMobileRelease, platformValue } from "../plan-mobile-release.mjs";
import { checkNativeVersion } from "../../check-mobile-native-version.mjs";
import { USES_ANY_LOCAL_ACTION, runsInstall, workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UPDATE_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "_mobile-update.yml");
const DEPLOY_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "deploy-production.yml");
const CI_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "ci.yml");

const SHA = "a".repeat(40);
const IOS_SHA = "1".repeat(40);
const ANDROID_SHA = "2".repeat(40);
const BASE_SHA = "3".repeat(40);

function lock(versions) {
  return { packages: Object.fromEntries(Object.entries(versions).map(([n, v]) => [`node_modules/${n}`, { version: v }])) };
}
const NATIVE = new Set(["expo-haptics", "@sentry/react-native"]);
const isNative = (key) => NATIVE.has(packageNameFromLockPath(key));
const HEAD_LOCK = lock({ "expo-haptics": "57.0.3", react: "19.2.3" });

const entry = (platform, version, build, sha) => ({ platform, version, build, sha, recorded: "2026-11-05" });
const registry = (...builds) => JSON.stringify({ builds });

/** A git double: the longest matching prefix of the joined command answers; anything else succeeds empty. */
function fakeGit(answers = {}) {
  const calls = [];
  const ordered = Object.entries(answers).sort(([a], [b]) => b.length - a.length);
  const git = (args) => {
    const key = args.join(" ");
    calls.push(key);
    for (const [prefix, result] of ordered) {
      if (key.startsWith(prefix)) return { status: 0, stdout: "", stderr: "", ...result };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { git, calls };
}

/** Each recorded commit's lockfile, as `git show <sha>:package-lock.json` answers it. */
const locksAt = (bySha) =>
  Object.fromEntries(Object.entries(bySha).map(([sha, l]) => [`show ${sha}:${LOCKFILE}`, { stdout: JSON.stringify(l) }]));

// ── The comparison all three share ──────────────────────────────────────────

describe("compareNativeInputs", () => {
  it("names each build's differences, and an unreachable commit as an error", () => {
    const { git } = fakeGit({
      ...locksAt({ [IOS_SHA]: HEAD_LOCK, [ANDROID_SHA]: lock({ "expo-haptics": "57.0.1", react: "19.2.3" }) }),
      [`diff --quiet ${IOS_SHA} HEAD -- ${APP_CONFIG}`]: { status: 1 },
      [`cat-file -e ${BASE_SHA}`]: { status: 1 },
    });
    const results = compareNativeInputs({
      builds: [entry("ios", "0.9.2", "9", IOS_SHA), entry("android", "0.9.2", "4", ANDROID_SHA), { label: "the base", sha: BASE_SHA }],
      git,
      headLock: HEAD_LOCK,
      isNative,
    });
    assert.deepEqual(results[0].changed, [APP_CONFIG]);
    assert.equal(results[0].label, "ios 0.9.2 build 9 (111111111111)");
    assert.deepEqual(results[1].changed, ["expo-haptics 57.0.1 -> 57.0.3"]);
    assert.match(results[2].error, /Commit 3{40} of the base isn't available/);
  });
});

// ── The plan ────────────────────────────────────────────────────────────────

describe("planMobileRelease", () => {
  const same = (builds) => builds.map((build) => ({ build, label: build.platform, changed: [] }));

  it("a named platform is a store build of it and no update, whatever is recorded", () => {
    for (const mode of ["ios", "android", "all"]) {
      const plan = planMobileRelease({ mode, registry: { builds: [] }, compare: () => assert.fail("no comparison") });
      assert.deepEqual([plan.ok, plan.build, plan.update], [true, mode, "none"], mode);
    }
  });

  it("anything else does nothing", () => {
    for (const mode of ["none", "", "bogus", "AUTO"]) {
      const plan = planMobileRelease({ mode, registry: { builds: [] }, compare: () => assert.fail("no comparison") });
      assert.deepEqual([plan.build, plan.update], ["none", "none"], mode);
    }
  });

  it("auto updates a platform whose recorded build matches, and builds one with none recorded", () => {
    const reg = { builds: [entry("android", "0.9.2", "4", ANDROID_SHA), entry("ios", "0.9.1", "8", IOS_SHA)] };
    const plan = planMobileRelease({ mode: "auto", runtime: "0.9.2", registry: reg, compare: same, hasGuard: true });
    assert.deepEqual([plan.build, plan.update], ["ios", "android"]);
    assert.match(plan.lines.join("\n"), /No ios build of 0\.9\.2 is recorded/);

    const both = planMobileRelease({
      mode: "auto",
      runtime: "0.9.2",
      registry: { builds: [entry("android", "0.9.2", "4", ANDROID_SHA), entry("ios", "0.9.2", "9", IOS_SHA)] },
      compare: same,
      hasGuard: true,
    });
    assert.deepEqual([both.build, both.update], ["none", "all"]);

    const fresh = planMobileRelease({ mode: "auto", runtime: "0.9.3", registry: reg, compare: same, hasGuard: true });
    assert.deepEqual([fresh.build, fresh.update], ["all", "none"], "a new version has nothing to update");
  });

  it("auto builds both platforms, publishes nothing, and warns when a build of the version differs natively", () => {
    const reg = { builds: [entry("android", "0.9.2", "4", ANDROID_SHA), entry("ios", "0.9.2", "9", IOS_SHA)] };
    const plan = planMobileRelease({
      mode: "auto",
      runtime: "0.9.2",
      registry: reg,
      compare: (builds) => builds.map((build) => ({ build, label: build.platform, changed: build.platform === "ios" ? [APP_JSON] : [] })),
    });
    assert.deepEqual([plan.ok, plan.build, plan.update], [true, "all", "none"]);
    assert.match(plan.warnings[0], /without an expo\.version bump/);
    assert.match(plan.lines[0], /ios has other native inputs: apps\/mobile\/app\.json/);
  });

  it("auto refuses, rather than guess, when a build can't be compared or there is no version", () => {
    const reg = { builds: [entry("android", "0.9.2", "4", ANDROID_SHA)] };
    const plan = planMobileRelease({
      mode: "auto",
      runtime: "0.9.2",
      registry: reg,
      compare: (builds) => builds.map((build) => ({ build, label: "x", changed: [], error: "gone" })),
    });
    assert.deepEqual(plan, { ok: false, error: "gone" });
    assert.equal(planMobileRelease({ mode: "auto", runtime: undefined, registry: reg, compare: same }).ok, false);
  });

  it("refuses an update from a commit older than the guard, whose publish would be a bare eas update", () => {
    const reg = { builds: [entry("android", "0.9.0", "2", ANDROID_SHA)] };
    const plan = planMobileRelease({ mode: "auto", runtime: "0.9.0", registry: reg, compare: same, hasGuard: false });
    assert.equal(plan.ok, false);
    assert.match(plan.error, /predates the OTA guard/);
    // With nothing to update, a pre-guard commit still builds: no publish runs.
    const build = planMobileRelease({ mode: "auto", runtime: "0.9.3", registry: reg, compare: same, hasGuard: false });
    assert.deepEqual([build.ok, build.build, build.update], [true, "all", "none"]);
  });

  it("names a platform set the way the jobs read it", () => {
    assert.equal(platformValue([]), "none");
    assert.equal(platformValue(["android"]), "android");
    assert.equal(platformValue(["ios", "android"]), "all");
  });
});

describe("planFromCheckout", () => {
  function checkout({ appVersion = "0.9.2", installed = HEAD_LOCK, guard = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "plan-mobile-"));
    mkdirSync(join(dir, "apps", "mobile"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    if (guard) writeFileSync(join(dir, "scripts", "eas-update.mjs"), "");
    // expo-haptics carries native code in this tree; react doesn't.
    mkdirSync(join(dir, "node_modules", "expo-haptics", "android"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "react"), { recursive: true });
    writeFileSync(join(dir, APP_JSON), JSON.stringify({ expo: { version: appVersion } }));
    writeFileSync(join(dir, LOCKFILE), JSON.stringify(HEAD_LOCK));
    writeFileSync(join(dir, "node_modules", ".package-lock.json"), JSON.stringify(installed));
    return dir;
  }
  const tagged = (over = {}) =>
    fakeGit({
      "rev-parse HEAD": { stdout: `${SHA}\n` },
      "tag --list v*": { stdout: "v0.10.0\nv0.9.0\n" },
      "rev-parse v0.10.0^{commit}": { stdout: `${SHA}\n` },
      ...locksAt({ [ANDROID_SHA]: HEAD_LOCK }),
      ...over,
    });

  it("plans from the shipped tree when it is exactly the latest tag", () => {
    const dir = checkout();
    try {
      const plan = planFromCheckout({ mode: "auto", sha: SHA, deployedDir: dir, registryText: registry(entry("android", "0.9.2", "4", ANDROID_SHA)), git: tagged().git });
      assert.deepEqual([plan.ok, plan.build, plan.update, plan.runtime], [true, "ios", "android", "0.9.2"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a checkout that isn't the SHA, a tag that moved, a stale install or a malformed registry", () => {
    const dir = checkout();
    const stale = checkout({ installed: lock({ "expo-haptics": "57.0.1", react: "19.2.3" }) });
    const reg = registry(entry("android", "0.9.2", "4", ANDROID_SHA));
    try {
      const other = planFromCheckout({ mode: "auto", sha: SHA, deployedDir: dir, registryText: reg, git: tagged({ "rev-parse HEAD": { stdout: `${BASE_SHA}\n` } }).git });
      assert.match(other.error, /HEAD is 3{40}, not a{40}/);
      const moved = planFromCheckout({ mode: "auto", sha: SHA, deployedDir: dir, registryText: reg, git: tagged({ "rev-parse v0.10.0^{commit}": { stdout: `${BASE_SHA}\n` } }).git });
      assert.match(moved.error, /production has shipped another commit/);
      const rc = planFromCheckout({ mode: "auto", sha: SHA, deployedDir: dir, registryText: reg, git: tagged({ "tag --list v*": { stdout: "v1.0.0-rc1\n" } }).git });
      assert.match(rc.error, /not a vX\.Y\.Z release/);
      const old = planFromCheckout({ mode: "auto", sha: SHA, deployedDir: stale, registryText: reg, git: tagged().git });
      assert.match(old.error, /install doesn't match its lockfile/);
      assert.match(planFromCheckout({ mode: "auto", sha: SHA, deployedDir: dir, registryText: "{", git: tagged().git }).error, /malformed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(stale, { recursive: true, force: true });
    }
  });

  it("judges native code from the shipped tree's own install, and refuses a pre-guard tree", () => {
    const dir = checkout();
    const old = checkout({ guard: false });
    const reg = registry(entry("android", "0.9.2", "4", ANDROID_SHA));
    try {
      const moved = tagged(locksAt({ [ANDROID_SHA]: lock({ "expo-haptics": "57.0.1", react: "19.2.3" }) })).git;
      const plan = planFromCheckout({ mode: "auto", sha: SHA, deployedDir: dir, registryText: reg, git: moved });
      assert.deepEqual([plan.build, plan.update], ["all", "none"], "expo-haptics moved under 0.9.2");
      assert.match(plan.lines[0], /expo-haptics 57\.0\.1 -> 57\.0\.3/);
      const jsOnly = tagged(locksAt({ [ANDROID_SHA]: lock({ "expo-haptics": "57.0.3", react: "19.2.2" }) })).git;
      const fine = planFromCheckout({ mode: "auto", sha: SHA, deployedDir: dir, registryText: reg, git: jsOnly });
      assert.deepEqual([fine.build, fine.update], ["ios", "android"], "a JS-only move still updates");
      const bare = planFromCheckout({ mode: "auto", sha: SHA, deployedDir: old, registryText: reg, git: tagged().git });
      assert.match(bare.error, /predates the OTA guard/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(old, { recursive: true, force: true });
    }
  });

  it("hands its verdict to the jobs as build= and update=, through the job outputs they read", () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-main-"));
    try {
      const out = join(dir, "out");
      const summary = join(dir, "summary");
      writeFileSync(out, "");
      writeFileSync(summary, "");
      const status = planMain({ MOBILE_BUILD: "android", DEPLOY_SHA: SHA, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary }, { registryText: registry() });
      assert.equal(status, 0);
      assert.equal(readFileSync(out, "utf8"), "build=android\nupdate=none\n");
      const failed = planMain({ MOBILE_BUILD: "android", DEPLOY_SHA: SHA, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary }, { registryText: "{" });
      assert.equal(failed, 1);
      assert.match(readFileSync(summary, "utf8"), /No store build and no update/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const job = workflowJobs(DEPLOY_WORKFLOW).find((j) => j.jobId === "mobile-plan");
    const outputs = job.keys.get("outputs");
    assert.equal(outputs.get("build"), "${{ steps.plan.outputs.build }}");
    assert.equal(outputs.get("update"), "${{ steps.plan.outputs.update }}");
    const step = workflowSteps(DEPLOY_WORKFLOW).find((s) => s.jobId === "mobile-plan" && s.name === "Plan the store build and the update");
    assert.match(step.body, /^\s+id: plan\s*$/m);
  });

  it("a named platform reads no checkout", () => {
    const plan = planFromCheckout({ mode: "ios", sha: SHA, deployedDir: "/nonexistent", registryText: registry(), git: () => assert.fail("no git") });
    assert.deepEqual([plan.build, plan.update], ["ios", "none"]);
  });

  it("the real registry parses, so the job can't fail on the file itself", () => {
    const plan = planFromCheckout({ mode: "all", sha: SHA, registryText: readFileSync(join(REPO_ROOT, SHIPPED_BUILDS), "utf8") });
    assert.equal(plan.ok, true);
  });
});

// ── The PR check ────────────────────────────────────────────────────────────

describe("checkNativeVersion", () => {
  const files = ({ version = "0.9.2", reg = registry(entry("android", "0.9.2", "4", ANDROID_SHA)), installed = HEAD_LOCK } = {}) => (p) => {
    const all = {
      [APP_JSON]: JSON.stringify({ expo: { version } }),
      [SHIPPED_BUILDS]: reg,
      [LOCKFILE]: JSON.stringify(HEAD_LOCK),
      "node_modules/.package-lock.json": JSON.stringify(installed),
    };
    if (!(p in all)) throw new Error(`unexpected read ${p}`);
    return all[p];
  };
  const changedLock = lock({ "expo-haptics": "57.0.1", react: "19.2.3" });

  it("passes a version nothing has shipped, and one whose builds still match", () => {
    assert.equal(checkNativeVersion({ readFile: files({ version: "0.9.3" }), git: () => assert.fail("no git"), isNative }).status, "pass");
    const { git } = fakeGit(locksAt({ [ANDROID_SHA]: HEAD_LOCK }));
    assert.equal(checkNativeVersion({ readFile: files(), git, isNative, baseSha: BASE_SHA }).status, "pass");
  });

  it("fails a pull request whose own change moves native inputs under a shipped version", () => {
    const { git } = fakeGit(locksAt({ [ANDROID_SHA]: changedLock, [BASE_SHA]: changedLock }));
    const result = checkNativeVersion({ readFile: files(), git, isNative, baseSha: BASE_SHA });
    assert.equal(result.status, "fail");
    assert.match(result.lines.join("\n"), /expo-haptics 57\.0\.1 -> 57\.0\.3/);
    assert.match(result.lines.at(-1), /Bump expo\.version/);
  });

  it("only warns when the difference was already on the base, or on a push", () => {
    const { git } = fakeGit(locksAt({ [ANDROID_SHA]: changedLock, [BASE_SHA]: HEAD_LOCK }));
    const pr = checkNativeVersion({ readFile: files(), git, isNative, baseSha: BASE_SHA });
    assert.equal(pr.status, "warn");
    assert.match(pr.lines.at(-1), /its own pull request/);
    assert.equal(checkNativeVersion({ readFile: files(), git, isNative }).status, "warn");
  });

  it("fails rather than pass unread: a stale install, an unreachable build, a missing version", () => {
    const { git } = fakeGit(locksAt({ [ANDROID_SHA]: HEAD_LOCK }));
    assert.match(checkNativeVersion({ readFile: files({ installed: changedLock }), git, isNative }).lines[0], /Run `npm ci` first/);
    const gone = fakeGit({ [`cat-file -e ${ANDROID_SHA}`]: { status: 1 } }).git;
    assert.equal(checkNativeVersion({ readFile: files(), git: gone, isNative }).status, "fail");
    const noVersion = (p) => (p === APP_JSON ? "{}" : files()(p));
    assert.equal(checkNativeVersion({ readFile: noVersion, git, isNative }).status, "fail");
  });
});

describe("the check runs on every PR, judging the PR's own change", () => {
  it("is a mobile-validate step after the install, with the test merge's first parent as the base", () => {
    const steps = workflowSteps(CI_WORKFLOW).filter((s) => s.jobId === "mobile-validate");
    const at = steps.findIndex((s) => s.name === "Native changes carry an expo.version bump");
    assert.notEqual(at, -1, "mobile-validate has no native-version step");
    const install = steps.findIndex((s) => /install: ci/.test(s.body));
    assert.ok(install !== -1 && install < at, "it reads the installed tree, so it runs after npm ci");
    assert.match(steps[at].body, /run: npm run check:mobile-native-version/);
    assert.match(steps[at].body, /BASE_SHA: \$\{\{ github\.event_name != 'push' && 'HEAD\^1' \|\| '' \}\}/);
    assert.doesNotMatch(steps[at].body, /\bif:/, "a required check that skips passes");
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:mobile-native-version"], "node scripts/check-mobile-native-version.mjs");
    const checkout = steps.find((s) => /actions\/checkout@/.test(s.body));
    assert.match(checkout.body, /fetch-depth: 0/, "the base and the build commits must be reachable");
  });
});

// ── The publishing workflow ─────────────────────────────────────────────────

describe("_mobile-update.yml", () => {
  const steps = () => workflowSteps(UPDATE_WORKFLOW).filter((s) => s.jobId === "publish");
  const text = () => readFileSync(UPDATE_WORKFLOW, "utf8");

  it("is callable only, with one job in automation that adds no Approve click", () => {
    const on = text().match(/^on:\n((?: {2}.*\n|\n)*)/m)?.[1] ?? "";
    assert.deepEqual(on.split("\n").filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim()), ["workflow_call:"]);
    const jobs = workflowJobs(UPDATE_WORKFLOW);
    assert.deepEqual(jobs.map((j) => j.jobId), ["publish"]);
    const env = jobs[0].keys.get("environment");
    assert.equal(env.get("name"), "automation");
    assert.equal(env.get("deployment"), "false");
  });

  it("checks out the shipped SHA, loads no local action, and installs before any step holds EXPO_TOKEN", () => {
    const all = steps();
    assert.ok(!all.some((s) => USES_ANY_LOCAL_ACTION.test(s.body)), "a local action would load from the deployed tree");
    const checkout = all.find((s) => /actions\/checkout@/.test(s.body));
    assert.match(checkout.body, /ref: \$\{\{ inputs\.sha \}\}/);
    assert.match(checkout.body, /persist-credentials: false/);
    const withToken = all.map((s, i) => [s, i]).filter(([s]) => /EXPO_TOKEN: \$\{\{ secrets\.EXPO_TOKEN \}\}/.test(s.body));
    assert.deepEqual(withToken.map(([s]) => s.name), ["Publish through the guard"]);
    const installs = all.map((s, i) => [s, i]).filter(([s]) => s.body.split("\n").some(runsInstall) || /scripts\/eas\.mjs --version/.test(s.body));
    assert.equal(installs.length, 2);
    for (const [, i] of installs) assert.ok(i < withToken[0][1], "every install runs before the token appears");
  });

  it("installs nothing that runs a script, and refuses a tree without the guard before the token appears", () => {
    const install = steps().find((s) => s.name === "Install dependencies (no install scripts)");
    assert.match(install.body, /run: npm ci --ignore-scripts/);
    const confirm = steps().find((s) => s.name === "Confirm the tree is exactly the shipped commit");
    assert.match(confirm.body, /\[ ! -f scripts\/eas-update\.mjs \]/);
  });

  it("publishes only through the guard, to the production channel, for the planned platform", () => {
    const publish = steps().find((s) => s.name === "Publish through the guard");
    assert.match(publish.body, /npm run eas -- update --channel production --platform "\$PLATFORM" --non-interactive/);
    assert.doesNotMatch(text(), /^\s+(?:run:\s*)?eas update\b/m, "a bare eas update skips the guard");
    assert.match(publish.body, /SENTRY_AUTH_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/);
  });
});
