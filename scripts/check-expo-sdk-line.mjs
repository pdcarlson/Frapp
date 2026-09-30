#!/usr/bin/env node

// Expo SDK-line gate (#2330): every Expo client package apps/mobile installs must
// be on the installed SDK's line, and Dependabot must be told to leave each one
// alone.
//
// Why a gate. An Expo client package's major version IS its SDK line: the 58.x
// release of `expo-apple-authentication` is built against `expo-modules-core@58`
// and calls native API the 57 line does not have. Dependabot moved it and
// `expo-localization` to 58.0.0 as ordinary majors (#2218, #2217), and the first
// iOS production EAS build died in the Xcode compile with `type 'Utilities' has
// no member 'keyWindow'`. Nothing in CI compiles Swift (`expo prebuild
// --no-install` generates the native project without building it), so that bump
// passed npm ci, lint, check-types, every suite and prebuild. The only guard was
// a hand-kept ignore list in .github/dependabot.yml, and ten packages had sat
// outside it for months.
//
// Two checks, both offline:
//
// 1. The SDK line. For every `expo-*` and `@expo/*` dependency of apps/mobile,
//    the INSTALLED version (what `npm ci` put on disk from the lockfile) must
//    satisfy the range the installed `expo`'s `bundledNativeModules.json` gives
//    it. That file is the SDK's own statement of its native module set, and
//    `npx expo install --check` reads the same map; this reads it directly
//    because that command also checks packages this gate deliberately leaves
//    out (below), and needs `EXPO_OFFLINE=1` to stay off the network.
// 2. The roster. Every `expo-*` dependency has an exact `dependency-name` entry
//    in the npm ignore list of .github/dependabot.yml, and every `expo-*` entry
//    there is a dependency. Exact names only: the list must not collapse into an
//    `expo-*` glob, which would also freeze `expo-server-sdk`, an apps/api
//    dependency with no tie to the mobile SDK.
//
// Out of scope, on purpose: `@sentry/react-native` and `@stripe/stripe-react-
// native` are in the bundled map too and are held AHEAD of it deliberately.
// Whether that is right is #2336's decision; checking them here, or allowlisting
// them, would be making it. The `react-native*` family moves with React
// (AGENTS.md § Gotchas), not by this map.
//
// What a green run does NOT prove: that a package inside its range compiles, or
// that the app's own native code and config plugins do. It asserts SDK-line
// coherence and nothing more.
//
// See docs/internal/ci-cd/AGENT_INFRA.md § The ignore list is a runtime
// constraint, not a preference.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const MOBILE_DIR = "apps/mobile";
const DEPENDABOT_CONFIG = ".github/dependabot.yml";

/**
 * `expo-*` / `@expo/*` dependencies the SDK's bundled map has no entry for,
 * each with the reason it may still ship. Empty today: every one apps/mobile
 * declares is an Expo SDK package. A third-party package that merely shares the
 * prefix would go here rather than failing the gate forever; an Expo package
 * missing from the map means the installed `expo` and the manifest disagree
 * about which SDK this is, which is exactly what the gate is for.
 */
export const UNBUNDLED_EXPO_PACKAGES = new Map();

/** Whether a dependency name is an Expo SDK package this gate checks. */
export function isExpoPackage(name) {
  return name.startsWith("expo-") || name.startsWith("@expo/");
}

/**
 * `[major, minor, patch, prerelease]` for a plain semver version, or null.
 * Build metadata is dropped, as semver says it must not affect precedence.
 */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(version).trim(),
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null];
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether `version` satisfies `range`, for the three range forms
 * `bundledNativeModules.json` uses: exact (`1.2.3`), tilde (`~1.2.3`) and caret
 * (`^1.2.3`). Anything else throws rather than guessing: a gate that
 * misreads a range passes or fails on nothing.
 *
 * A prerelease version satisfies none of them, the way npm treats one against
 * a range with no prerelease of its own (and a prerelease range is not a form
 * this reads). That fails closed on a canary build, which is the right answer
 * for a native module.
 */
export function satisfies(version, range) {
  const installed = parseVersion(version);
  if (!installed) throw new Error(`not a semver version: "${version}"`);

  const match = /^([~^]?)(\d+\.\d+\.\d+)$/.exec(String(range).trim());
  if (!match) {
    throw new Error(
      `unsupported range "${range}": this gate reads exact, ~ and ^ ranges only; extend satisfies() in scripts/check-expo-sdk-line.mjs`,
    );
  }
  const [, operator, base] = match;
  const floor = parseVersion(base);

  if (installed[3] !== null) return false;
  if (operator === "") return compare(installed, floor) === 0;
  if (compare(installed, floor) < 0) return false;

  if (operator === "~") {
    return installed[0] === floor[0] && installed[1] === floor[1];
  }
  // Caret: the leftmost non-zero part is fixed.
  if (floor[0] > 0) return installed[0] === floor[0];
  if (floor[1] > 0) return installed[0] === 0 && installed[1] === floor[1];
  return installed[0] === 0 && installed[1] === 0 && installed[2] === floor[2];
}

/**
 * The SDK-line violations, one message per package.
 *
 * - `dependencies`: apps/mobile's `dependencies` map.
 * - `bundled`: the installed `expo`'s `bundledNativeModules.json`.
 * - `installedVersion(name)`: the version on disk, or null when not installed.
 */
export function sdkLineViolations({ dependencies, bundled, installedVersion }) {
  const violations = [];
  for (const name of Object.keys(dependencies).filter(isExpoPackage).sort()) {
    const range = bundled[name];
    if (range === undefined) {
      if (!UNBUNDLED_EXPO_PACKAGES.has(name)) {
        violations.push(
          `${name}: the installed expo's bundledNativeModules.json has no entry for it, so its SDK line can't be checked`,
        );
      }
      continue;
    }
    const version = installedVersion(name);
    if (version === null) {
      violations.push(`${name}: declared in ${MOBILE_DIR}/package.json but not installed (run npm ci)`);
      continue;
    }
    if (!satisfies(version, range)) {
      violations.push(`${name}@${version} is outside this SDK's line: expected ${range}`);
    }
  }
  return violations;
}

/**
 * The `dependency-name` values in the ignore list of the npm entry for
 * directory "/" in a dependabot.yml.
 *
 * A line reader, not a YAML parser: the repo has no YAML dependency, and this
 * file's shape is fixed (block style, one `- dependency-name:` per line). It
 * throws when it finds no such entry or no ignore list, so a restructured file
 * fails the gate loudly instead of reading as an empty roster.
 */
export function dependabotIgnoreNames(text) {
  const lines = text.split(/\r?\n/);
  const indentOf = (line) => line.length - line.trimStart().length;
  const isContent = (line) => line.trim() !== "" && !line.trim().startsWith("#");
  const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

  // Each `updates:` entry, as the range of lines it spans.
  const entries = [];
  lines.forEach((line, i) => {
    if (/^\s*-\s+package-ecosystem:/.test(line)) entries.push({ start: i, indent: indentOf(line) });
  });
  const entry = entries
    .map((e, k) => ({ ...e, end: k + 1 < entries.length ? entries[k + 1].start : lines.length }))
    .find((e) => {
      const body = lines.slice(e.start, e.end);
      const ecosystem = /package-ecosystem:\s*(.+?)\s*(#.*)?$/.exec(body[0])?.[1];
      const directory = body
        .map((l) => /^\s*directory:\s*(.+?)\s*(#.*)?$/.exec(l)?.[1])
        .find((d) => d !== undefined);
      return unquote(ecosystem ?? "") === "npm" && unquote(directory ?? "") === "/";
    });
  if (!entry) throw new Error(`${DEPENDABOT_CONFIG}: no npm entry for directory "/"`);

  const ignoreAt = lines.findIndex(
    (l, i) => i > entry.start && i < entry.end && /^\s*ignore:\s*(#.*)?$/.test(l),
  );
  if (ignoreAt === -1) throw new Error(`${DEPENDABOT_CONFIG}: the npm entry has no ignore list`);

  const names = [];
  const listIndent = indentOf(lines[ignoreAt]);
  for (let i = ignoreAt + 1; i < entry.end; i++) {
    const line = lines[i];
    if (!isContent(line)) continue;
    if (indentOf(line) <= listIndent) break;
    const match = /^\s*-\s+dependency-name:\s*(.+?)\s*(#.*)?$/.exec(line);
    if (match) names.push(unquote(match[1]));
  }
  if (names.length === 0) throw new Error(`${DEPENDABOT_CONFIG}: the npm ignore list names nothing`);
  return names;
}

/**
 * The roster violations: an `expo-*` dependency Dependabot is free to bump, and
 * an `expo-*` ignore entry for a package apps/mobile no longer declares (a
 * stale entry makes the list read as covering a package it doesn't guard).
 *
 * `@expo/*` needs no per-package check: the list carries that glob, which
 * matches nothing outside the SDK.
 */
export function rosterViolations({ dependencies, ignoreNames }) {
  const expoDeps = Object.keys(dependencies).filter((n) => n.startsWith("expo-"));
  const listed = new Set(ignoreNames);
  const violations = [];
  for (const name of expoDeps.sort()) {
    if (!listed.has(name)) {
      violations.push(
        `${name}: not in ${DEPENDABOT_CONFIG}'s ignore list, so Dependabot can move it off the SDK line`,
      );
    }
  }
  for (const name of [...listed].filter((n) => n.startsWith("expo-")).sort()) {
    if (name.includes("*")) {
      violations.push(
        `${name}: a glob in ${DEPENDABOT_CONFIG}'s ignore list; list Expo client packages by exact name (a glob also freezes expo-server-sdk)`,
      );
    } else if (!(name in dependencies)) {
      violations.push(
        `${name}: listed in ${DEPENDABOT_CONFIG}'s ignore list but not a dependency of ${MOBILE_DIR}; remove the stale entry`,
      );
    }
  }
  return violations;
}

/**
 * The directory `name` is installed in for apps/mobile, or null: its own
 * node_modules first, then the hoisted root copy, the order Node resolves in.
 */
export function installedPackageDir(root, name) {
  for (const dir of [join(root, MOBILE_DIR, "node_modules"), join(root, "node_modules")]) {
    if (existsSync(join(dir, name, "package.json"))) return join(dir, name);
  }
  return null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function main(root = process.cwd()) {
  const { dependencies = {} } = readJson(join(root, MOBILE_DIR, "package.json"));
  const installedVersion = (name) => {
    const dir = installedPackageDir(root, name);
    return dir === null ? null : readJson(join(dir, "package.json")).version;
  };

  // The map comes from the same copy of expo the app resolves, so the SDK it
  // describes is the one that ships.
  const expoDir = installedPackageDir(root, "expo");
  const bundledPath = expoDir && join(expoDir, "bundledNativeModules.json");
  if (!bundledPath || !existsSync(bundledPath)) {
    return {
      expoVersion: null,
      checked: 0,
      violations: ["expo or its bundledNativeModules.json is not installed, so there is no SDK to check against (run npm ci)"],
    };
  }
  const expoVersion = readJson(join(expoDir, "package.json")).version;
  const bundled = readJson(bundledPath);
  const ignoreNames = dependabotIgnoreNames(readFileSync(join(root, DEPENDABOT_CONFIG), "utf8"));

  return {
    expoVersion,
    checked: Object.keys(dependencies).filter(isExpoPackage).length,
    violations: [
      ...sdkLineViolations({ dependencies, bundled, installedVersion }),
      ...rosterViolations({ dependencies, ignoreNames }),
    ],
  };
}

if (isInvokedDirectly(import.meta.url)) {
  const { expoVersion, checked, violations } = main();
  if (violations.length === 0) {
    console.log(
      `✓ ${checked} Expo packages on the expo@${expoVersion} SDK line, and every expo-* dependency is in Dependabot's ignore list`,
    );
    process.exit(0);
  }
  console.error(`\n✗ Expo SDK-line check failed${expoVersion ? ` (expo@${expoVersion})` : ""}.\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "\n  Expo client packages move only as a set, with a planned SDK upgrade (#2329).\n" +
      "  Target versions: node_modules/expo/bundledNativeModules.json. Why: docs/internal/ci-cd/AGENT_INFRA.md\n" +
      "  § The ignore list is a runtime constraint, not a preference.\n",
  );
  process.exit(1);
}
