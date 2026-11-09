// A change to the app's native inputs must come with an `expo.version` bump (`npm run
// check:mobile-native-version`, ci.yml's `mobile-validate`).
//
// WHY. An OTA update reaches every store build of the same `expo.version` (the `appVersion`
// runtime policy). If native code changes while that version keeps its number, an update built
// from the new code reaches the old binaries and calls a module they don't have, and the app
// crashes at launch. The OTA guard (`scripts/eas-update.mjs`) refuses such a publish, and Deploy
// production's `auto` plan (`scripts/ci/plan-mobile-release.mjs`) falls back to store builds. This
// check moves the same rule to the pull request, where the bump is one line
// (spec/environments/README.md § Mobile (EAS), Native changes).
//
// THE RULE. Native inputs are what the guard compares: `apps/mobile/app.json`,
// `apps/mobile/app.config.js`, and the lockfile version of every installed package that carries
// native code. When HEAD's native inputs differ from a store build of HEAD's `expo.version`
// recorded in `apps/mobile/store/shipped-builds.json`:
//   * on a pull request (`BASE_SHA` set) whose own change differs natively from its base, fail;
//   * otherwise (the difference was already on the base, or a push to `main`), warn and pass. A
//     red `main` would block every deploy, and a PR that didn't cause it (the record PR that
//     lists a build, say) can't fix it by itself. The warning names the bump to make.
// A version with no recorded build is free to change: nothing an update could reach exists yet.
//
// It reads the installed tree, so it runs after `npm ci`, and it needs the recorded builds'
// commits (fetched when missing).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "./ci/lib/shipped-builds-registry.mjs";
import { APP_JSON, LOCKFILE, SHIPPED_BUILDS, compareNativeInputs, gitIn, installProblems, isNativePackage } from "./eas-update.mjs";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * `{ status: "pass" | "warn" | "fail", lines: string[] }`. `git`, `readFile` and `isNative` are
 * injectable for the tests.
 */
export function checkNativeVersion({
  baseSha,
  git = gitIn(ROOT),
  readFile = (p) => readFileSync(path.join(ROOT, p), "utf8"),
  isNative = (lockPath) => isNativePackage(path.join(ROOT, lockPath)),
} = {}) {
  let runtime;
  let registry;
  let headLock;
  try {
    runtime = JSON.parse(readFile(APP_JSON))?.expo?.version;
    registry = parseRegistry(readFile(SHIPPED_BUILDS));
    headLock = JSON.parse(readFile(LOCKFILE));
  } catch (error) {
    return { status: "fail", lines: [`Couldn't read ${APP_JSON}, ${SHIPPED_BUILDS} or ${LOCKFILE}: ${error.message}`] };
  }
  if (!runtime) return { status: "fail", lines: [`${APP_JSON} has no expo.version.`] };
  const builds = registry.builds.filter((b) => b.version === runtime);
  if (builds.length === 0) {
    return { status: "pass", lines: [`No store build of ${runtime} is recorded yet, so its native inputs are free to change.`] };
  }
  const stale = installProblems(readFile, headLock);
  if (stale.length) {
    return { status: "fail", lines: [`node_modules doesn't match ${LOCKFILE}, so the native check can't trust it. Run \`npm ci\` first. First mismatch: ${stale[0]}.`] };
  }
  const results = compareNativeInputs({ builds, git, headLock, isNative });
  const unreadable = results.filter((r) => r.error);
  if (unreadable.length) return { status: "fail", lines: unreadable.map((r) => r.error) };
  const differing = results.filter((r) => r.changed.length);
  if (differing.length === 0) {
    return { status: "pass", lines: [`Native inputs match every recorded store build of ${runtime}: ${results.map((r) => r.label).join(", ")}.`] };
  }
  const detail = differing.flatMap((r) => [`${r.label} differs:`, ...r.changed.map((c) => `  - ${c}`)]);
  const bump = `Bump expo.version in ${APP_JSON} (spec/environments/README.md § Mobile (EAS), Native changes).`;

  if (baseSha) {
    const [own] = compareNativeInputs({
      builds: [{ label: "the pull request's base", sha: baseSha }],
      git,
      headLock,
      isNative,
    });
    if (own.error) return { status: "fail", lines: [own.error] };
    if (own.changed.length) {
      return {
        status: "fail",
        lines: [
          `This change alters the app's native inputs while store builds of ${runtime} exist, so an OTA update of ${runtime} would crash them.`,
          "Native inputs this change touches:",
          ...own.changed.map((c) => `  - ${c}`),
          ...detail,
          `${bump} The new version starts a runtime that no shipped binary has.`,
        ],
      };
    }
  }
  return {
    status: "warn",
    lines: [
      `The base already differs natively from a store build of ${runtime}, so no update can reach ${runtime} until the version is bumped.`,
      ...detail,
      `${bump} Do it in its own pull request: this one didn't cause it.`,
    ],
  };
}

if (isInvokedDirectly(import.meta.url)) {
  const result = checkNativeVersion({ baseSha: process.env.BASE_SHA || undefined });
  const annotate = { fail: "::error::", warn: "::warning::", pass: "" }[result.status];
  if (process.env.GITHUB_ACTIONS && annotate) console.log(`${annotate}${result.lines[0]}`);
  for (const line of result.lines) console.log(line);
  process.exit(result.status === "fail" ? 1 : 0);
}
