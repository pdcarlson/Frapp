// What Deploy production does for the app after a live, tagged ship: an OTA update, a store
// build, both (one per platform), or nothing. `deploy-production.yml`'s `mobile-plan` job runs
// it, and its two outputs drive the `mobile` (store build) and `ota` (update) jobs.
//
// MODES (the `mobile_build` input).
//   * `ios`, `android`, `all`: a store build of that platform, and no update. What the input
//     always meant (#3111).
//   * `auto`: per platform, an update when the shipped commit can reach that platform's store
//     binary over the air, and a store build when it can't. The rule is the OTA guard's
//     (`scripts/eas-update.mjs`, #3472): an update reaches every store build of the same
//     `expo.version`, so it is safe only when every build of that version recorded in
//     `apps/mobile/store/shipped-builds.json` has the shipped commit's native inputs
//     (`compareNativeInputs`). So:
//       - Some recorded build of the version differs natively: store builds on both platforms,
//         no update, and a warning, because the version should have been bumped (the PR check
//         `check-mobile-native-version.mjs` now fails such a change). Until it is, every update
//         to that version is refused.
//       - Otherwise, a platform with a recorded build of the version gets an update, and a
//         platform with none gets a store build (a new version, or a platform never shipped).
//       - A platform that would get an update, from a commit older than the guard (a rollback to
//         a pre-#3475 SHA): the plan refuses, because that commit's `npm run eas -- update` is a
//         bare `eas update`.
//   * anything else: nothing.
//
// A named platform now waits for this job too, so a malformed registry on the dispatched ref
// stops it; CI's `api-contract-check` parses that file on every change.
//
// TRUST. This script is the trusted ref's (the dispatched `main`), and so is the registry it
// reads. The shipped commit is a separate checkout (`DEPLOYED_DIR`) whose dependencies were
// installed with `--ignore-scripts` in a job that holds no secret: it is read, never run. The
// job fails, and nothing builds or publishes, when the commit isn't the latest `v*` tag or
// can't be judged.
//
// Env: MOBILE_BUILD, DEPLOY_SHA, DEPLOYED_DIR (auto only), GITHUB_OUTPUT, GITHUB_STEP_SUMMARY.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "../check-api-breaking-changes.mjs";
import { APP_JSON, GUARD_PATH, LOCKFILE, compareNativeInputs, gitIn, installProblems, isNativePackage } from "../eas-update.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { latestReleaseTag } from "./lib/release-tag.mjs";
import { REGISTRY_PATH } from "./record-shipped-builds.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const PLATFORMS = ["ios", "android"];
const NAMED = new Set(["ios", "android", "all"]);

/** `["ios", "android"]` → `all`, `["ios"]` → `ios`, `[]` → `none`: the shape the jobs read. */
export function platformValue(list) {
  if (list.length === 0) return "none";
  if (PLATFORMS.every((p) => list.includes(p))) return "all";
  return list[0];
}

/**
 * The plan for one run. `compare(builds)` is `compareNativeInputs` bound to the shipped commit.
 * Returns `{ ok: true, build, update, runtime, lines, warnings }` or `{ ok: false, error }`.
 */
export function planMobileRelease({ mode, runtime, registry, compare, hasGuard = false }) {
  if (NAMED.has(mode)) {
    return { ok: true, build: mode, update: "none", runtime, lines: [`\`mobile_build\` is \`${mode}\`: a store build, no update.`], warnings: [] };
  }
  if (mode !== "auto") {
    return { ok: true, build: "none", update: "none", runtime, lines: [`\`mobile_build\` is \`${mode || "(empty)"}\`: nothing for the app.`], warnings: [] };
  }
  if (!runtime) return { ok: false, error: `${APP_JSON} at the shipped commit has no expo.version, so there is no runtime to judge.` };
  const builds = registry.builds.filter((b) => b.version === runtime);
  const results = compare(builds);
  const unreadable = results.filter((r) => r.error);
  if (unreadable.length) {
    return { ok: false, error: unreadable.map((r) => r.error).join(" ") };
  }
  const lines = [];
  const warnings = [];
  const differing = results.filter((r) => r.changed.length);
  if (differing.length) {
    for (const r of differing) {
      lines.push(`${r.label} has other native inputs: ${r.changed.join("; ")}.`);
    }
    warnings.push(
      `Native inputs changed since a store build of ${runtime} without an expo.version bump, so no update can reach ${runtime} safely. ` +
        `Building both platforms instead. Bump expo.version in ${APP_JSON} so the next ship can update over the air again ` +
        "(spec/environments/README.md § Mobile (EAS), Native changes). A store that has already approved this version refuses the upload.",
    );
    return { ok: true, build: "all", update: "none", runtime, lines, warnings };
  }
  const update = [];
  const build = [];
  for (const platform of PLATFORMS) {
    const mine = results.filter((r) => r.build.platform === platform);
    if (mine.length) {
      update.push(platform);
      lines.push(`${platform}: update over the air. Same native inputs as ${mine.map((r) => r.label).join(", ")}.`);
    } else {
      build.push(platform);
      lines.push(`${platform}: store build. No ${platform} build of ${runtime} is recorded in ${REGISTRY_PATH}, so an update would reach nothing.`);
    }
  }
  if (update.length && !hasGuard) {
    // The publish runs the shipped commit's own `npm run eas -- update`, and before #3475 that is
    // a bare `eas update`: no eas.json env, no fences, a bundle that calls localhost.
    return {
      ok: false,
      error:
        `The shipped commit predates the OTA guard (${GUARD_PATH}), so publishing from it would run a bare, unsafe ` +
        "`eas update`. Nothing was built or published; to build for the stores, dispatch again with mobile_build set to a platform.",
    };
  }
  return { ok: true, build: platformValue(build), update: platformValue(update), runtime, lines, warnings };
}

/**
 * Read the shipped checkout and the trusted registry, then plan. The checks that come before an
 * `auto` plan: the checkout is exactly `sha`, which is still the latest `v*` tag, and its install
 * matches its lockfile (the native check reads the installed tree).
 */
export function planFromCheckout({ mode, sha, deployedDir, registryText, git = gitIn(deployedDir) }) {
  let registry;
  try {
    registry = parseRegistry(registryText);
  } catch (error) {
    return { ok: false, error: `${REGISTRY_PATH} is malformed: ${error.message}` };
  }
  if (mode !== "auto") return planMobileRelease({ mode, registry });
  if (!deployedDir) return { ok: false, error: "DEPLOYED_DIR is empty, so there is no shipped checkout to read." };
  const head = git(["rev-parse", "HEAD"]);
  if (head.status !== 0 || head.stdout.trim() !== sha) {
    return { ok: false, error: `The shipped checkout's HEAD is ${head.stdout.trim() || "unreadable"}, not ${sha}.` };
  }
  const latest = latestReleaseTag({
    git: (a) => {
      const r = git(a);
      if (r.status !== 0) throw new Error(r.stderr.trim() || `git ${a.join(" ")} exited ${r.status}`);
      return r.stdout;
    },
  });
  if (!latest.ok) return { ok: false, error: `Can't tell what production serves: ${latest.error}.` };
  const tagged = git(["rev-parse", `${latest.tag}^{commit}`]);
  if (tagged.status !== 0 || tagged.stdout.trim() !== sha) {
    return {
      ok: false,
      error: `The latest tag, ${latest.tag}, is on ${tagged.stdout.trim() || "an unreadable commit"}, not ${sha}: production has shipped another commit since this run.`,
    };
  }
  const read = (p) => readFileSync(path.join(deployedDir, p), "utf8");
  let runtime;
  let headLock;
  try {
    runtime = JSON.parse(read(APP_JSON))?.expo?.version;
    headLock = JSON.parse(read(LOCKFILE));
  } catch (error) {
    return { ok: false, error: `Couldn't read the shipped commit's ${APP_JSON} or ${LOCKFILE}: ${error.message}` };
  }
  const stale = installProblems(read, headLock);
  if (stale.length) return { ok: false, error: `The shipped commit's install doesn't match its lockfile, so the native check can't trust it: ${stale[0]}.` };
  return planMobileRelease({
    mode,
    runtime,
    registry,
    hasGuard: existsSync(path.join(deployedDir, GUARD_PATH)),
    compare: (builds) =>
      compareNativeInputs({ builds, git, headLock, isNative: (lockPath) => isNativePackage(path.join(deployedDir, lockPath)) }),
  });
}

export function main(env = process.env, { registryText = readFileSync(path.join(ROOT, REGISTRY_PATH), "utf8") } = {}) {
  const mode = env.MOBILE_BUILD ?? "";
  const sha = env.DEPLOY_SHA ?? "";
  const plan = planFromCheckout({ mode, sha, deployedDir: env.DEPLOYED_DIR, registryText });
  const summary = [`### App release plan for \`${sha}\``, ""];
  if (!plan.ok) {
    summary.push(
      `> **No store build and no update.** ${plan.error}`,
      ">",
      "> Production is live and tagged. To ship the app anyway, re-run this job once the cause is fixed, or dispatch",
      "> Deploy production again with `mobile_build` set to a platform, which builds without this check.",
    );
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
    console.log(`::error::${plan.error}`);
    return 1;
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `build=${plan.build}\nupdate=${plan.update}\n`);
  summary.push("| | |", "| --- | --- |", `| Store build | \`${plan.build}\` |`, `| OTA update | \`${plan.update}\` |`);
  if (plan.runtime) summary.push(`| Runtime (\`expo.version\`) | \`${plan.runtime}\` |`);
  summary.push("", ...plan.lines.map((l) => `- ${l}`));
  for (const w of plan.warnings) {
    summary.push("", `> **Warning.** ${w}`);
    console.log(`::warning::${w}`);
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
  console.log(`Store build: ${plan.build}. Update: ${plan.update}.`);
  for (const l of plan.lines) console.log(l);
  return 0;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main());
}
