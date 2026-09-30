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
// 1. The SDK line. Every copy package-lock.json installs (declared or
//    transitive, hoisted or nested) of an `expo-*` or `@expo/*` package that the
//    installed `expo`'s `bundledNativeModules.json` lists must satisfy the range
//    the map gives it. That file is the SDK's own statement of its native module set;
//    `npx expo install --check` reads the same map but only for declared
//    packages, checks ones this gate deliberately leaves out (below), and needs
//    `EXPO_OFFLINE=1` to stay off the network. Transitive copies matter most:
//    `expo-modules-core`, the other side of the #2218 break, is one. The
//    lockfile rather than node_modules, because it is what `npm ci` installs
//    and it lists nested copies. An `expo-*` / `@expo/*` package apps/mobile
//    declares (in any dependency section) must also be in the map and installed,
//    and its declared range's floor must be on the line, so an edit to
//    package.json alone gets this diagnosis rather than only npm ci's.
//    An installed Expo package the map doesn't list (`expo-modules-jsi`,
//    `expo-modules-autolinking`, the `@expo/*` tooling, which has its own version
//    lines) isn't checked: the map is the only SDK statement there is to check
//    against, and `expo`'s own dependency ranges pin those.
// 2. The roster, in the npm "/" ignore list of .github/dependabot.yml:
//    - every `expo-*` package apps/mobile declares has an exact entry, and so
//      do `expo` and the `@expo/*` glob;
//    - each of those entries blocks major bumps (no `update-types`, or one that
//      includes `version-update:semver-major`), since a major is the next SDK;
//    - no glob matches `expo-server-sdk`, apps/api's push client, which has no
//      tie to the mobile SDK and would be frozen silently;
//    - every exact `expo-*` entry names a package apps/mobile declares or an
//      installed one the map lists (so `expo-server-sdk` can't be listed, and
//      a stale entry fails).
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
// See docs/ci-cd/dependency-updates.md § The ignore list is a runtime
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

/** Every package apps/mobile declares, across the sections npm installs from. */
export function declaredPackages(manifest) {
  return {
    ...manifest.optionalDependencies,
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
}

/**
 * Every installed copy in a package-lock.json (v2/v3) `packages` map, as
 * `{ path, name, version }`. Workspace links and the root entry carry no
 * installed copy and are skipped.
 */
export function lockfileCopies(lock) {
  const copies = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const at = path.lastIndexOf("node_modules/");
    if (at === -1 || entry.link) continue;
    copies.push({ path, name: path.slice(at + "node_modules/".length), version: entry.version });
  }
  if (copies.length === 0) throw new Error("package-lock.json lists no installed packages");
  return copies;
}

/**
 * The SDK-line violations, one message per package or copy.
 *
 * - `declared`: apps/mobile's declared packages ({@link declaredPackages}).
 * - `bundled`: the installed `expo`'s `bundledNativeModules.json`.
 * - `copies`: every installed copy ({@link lockfileCopies}).
 */
export function sdkLineViolations({ declared, bundled, copies }) {
  const violations = [];
  const installed = new Set(copies.map((c) => c.name));
  for (const name of Object.keys(declared).filter(isExpoPackage).sort()) {
    if (bundled[name] === undefined) {
      if (!UNBUNDLED_EXPO_PACKAGES.has(name)) {
        violations.push(
          `${name}: the installed expo's bundledNativeModules.json has no entry for it, so its SDK line can't be checked`,
        );
      }
    } else if (!installed.has(name)) {
      violations.push(`${name}: declared in ${MOBILE_DIR}/package.json but not in package-lock.json (run npm install)`);
    } else {
      // The declared range's floor, so an edit to package.json alone gets this
      // diagnosis too, not only npm ci's lockfile-mismatch error. A range this
      // can't read (a URL, `*`) is left to the installed-version check below.
      const floor = /^[~^]?(\d+\.\d+\.\d+)$/.exec(String(declared[name]).trim())?.[1];
      if (floor && !satisfies(floor, bundled[name])) {
        violations.push(
          `${name}: declared as ${declared[name]} in ${MOBILE_DIR}/package.json, outside this SDK's line: expected ${bundled[name]}`,
        );
      }
    }
  }
  const offLine = copies
    .filter((c) => isExpoPackage(c.name) && bundled[c.name] !== undefined)
    .filter((c) => !satisfies(c.version, bundled[c.name]))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const { path, name, version } of offLine) {
    const where = path === `node_modules/${name}` ? "" : ` (at ${path})`;
    violations.push(`${name}@${version}${where} is outside this SDK's line: expected ${bundled[name]}`);
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
  return dependabotIgnoreEntries(text).map((e) => e.name);
}

/**
 * The npm "/" ignore list as `{ name, updateTypes }`, where `updateTypes` is
 * the entry's `update-types` list, or null when it has none (every update is
 * ignored). Same reader and the same loud failures as {@link dependabotIgnoreNames}.
 */
export function dependabotIgnoreEntries(text) {
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

  const ignored = [];
  const listIndent = indentOf(lines[ignoreAt]);
  let current = null;
  let inUpdateTypes = false;
  for (let i = ignoreAt + 1; i < entry.end; i++) {
    const line = lines[i];
    if (!isContent(line)) continue;
    if (indentOf(line) <= listIndent) break;
    const match = /^\s*-\s+dependency-name:\s*(.+?)\s*(#.*)?$/.exec(line);
    if (match) {
      current = { name: unquote(match[1]), updateTypes: null, indent: indentOf(line) };
      ignored.push(current);
      inUpdateTypes = false;
      continue;
    }
    if (!current || indentOf(line) <= current.indent) {
      current = null;
      continue;
    }
    const key = /^\s*update-types:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (key) {
      current.updateTypes = [];
      const inline = /^\[(.*)\]$/.exec(key[1]);
      if (inline) {
        current.updateTypes = inline[1].split(",").map(unquote).filter(Boolean);
        inUpdateTypes = false;
      } else {
        inUpdateTypes = true;
      }
      continue;
    }
    const item = /^\s*-\s+(.+?)\s*(#.*)?$/.exec(line);
    if (inUpdateTypes && item) current.updateTypes.push(unquote(item[1]));
    else inUpdateTypes = false;
  }
  if (ignored.length === 0) throw new Error(`${DEPENDABOT_CONFIG}: the npm ignore list names nothing`);
  return ignored.map(({ name, updateTypes }) => ({ name, updateTypes }));
}

/** Whether an ignore entry keeps Dependabot from proposing a major bump. */
export function blocksMajor({ updateTypes }) {
  return updateTypes === null || updateTypes.includes("version-update:semver-major");
}

/**
 * The roster violations: an Expo package Dependabot is free to bump, and an
 * `expo-*` ignore entry for a package that apps/mobile doesn't declare and
 * that isn't an installed SDK package (`installedSdkNames`: installed copies
 * the bundled map lists). A stale entry makes the list read as covering a
 * package it doesn't guard; an entry for another workspace's `expo-*` package,
 * such as apps/api's `expo-server-sdk`, freezes it silently.
 *
 * `expo` and the `@expo/*` glob are required by name: the glob is what keeps
 * Dependabot off every `@expo/*` package, declared or transitive, so dropping it
 * is the same gap as dropping an `expo-*` entry.
 */
export function rosterViolations({ declared, installedSdkNames, ignoreNames, majorsLetThrough = new Set() }) {
  const listed = new Set(ignoreNames);
  const required = Object.keys(declared)
    .filter((n) => n === "expo" || n.startsWith("expo-"))
    .sort();
  if ([...Object.keys(declared), ...installedSdkNames].some((n) => n.startsWith("@expo/"))) {
    required.push("@expo/*");
  }
  const violations = [];
  for (const name of required) {
    if (!listed.has(name)) {
      violations.push(
        `${name}: not in ${DEPENDABOT_CONFIG}'s ignore list, so Dependabot can move it off the SDK line`,
      );
    } else if (majorsLetThrough.has(name)) {
      violations.push(
        `${name}: its ${DEPENDABOT_CONFIG} ignore entry's update-types leave out version-update:semver-major, so Dependabot can still move it to the next SDK`,
      );
    }
  }
  for (const name of [...listed].filter((n) => n.includes("*")).sort()) {
    if (globMatches(name, "expo-server-sdk")) {
      violations.push(
        `${name}: a glob in ${DEPENDABOT_CONFIG}'s ignore list that also freezes apps/api's expo-server-sdk; list Expo client packages by exact name`,
      );
    }
  }
  for (const name of [...listed].filter((n) => n.startsWith("expo-") && !n.includes("*")).sort()) {
    if (!(name in declared) && !installedSdkNames.has(name)) {
      violations.push(
        `${name}: listed in ${DEPENDABOT_CONFIG}'s ignore list but neither declared by ${MOBILE_DIR} nor an installed Expo SDK package; remove the entry`,
      );
    }
  }
  return violations;
}

/**
 * Whether a Dependabot `dependency-name` pattern matches `name`: `*` matches
 * any run of characters, everything else is literal.
 */
export function globMatches(pattern, name) {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(name);
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
  const declared = declaredPackages(readJson(join(root, MOBILE_DIR, "package.json")));
  const copies = lockfileCopies(readJson(join(root, "package-lock.json")));

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
  const ignoreEntries = dependabotIgnoreEntries(readFileSync(join(root, DEPENDABOT_CONFIG), "utf8"));
  const ignoreNames = ignoreEntries.map((e) => e.name);
  const majorsLetThrough = new Set(ignoreEntries.filter((e) => !blocksMajor(e)).map((e) => e.name));

  return {
    expoVersion,
    checked: copies.filter((c) => isExpoPackage(c.name) && bundled[c.name] !== undefined).length,
    violations: [
      ...sdkLineViolations({ declared, bundled, copies }),
      ...rosterViolations({
        declared,
        installedSdkNames: new Set(copies.map((c) => c.name).filter((n) => bundled[n] !== undefined)),
        ignoreNames,
        majorsLetThrough,
      }),
    ],
  };
}

if (isInvokedDirectly(import.meta.url)) {
  const { expoVersion, checked, violations } = main();
  if (violations.length === 0) {
    console.log(
      `✓ ${checked} installed Expo packages on the expo@${expoVersion} SDK line, and Dependabot's ignore list covers them`,
    );
    process.exit(0);
  }
  console.error(`\n✗ Expo SDK-line check failed${expoVersion ? ` (expo@${expoVersion})` : ""}.\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "\n  Expo client packages move only as a set, with a planned SDK upgrade (#2329).\n" +
      "  Target versions: node_modules/expo/bundledNativeModules.json. Why: docs/ci-cd/dependency-updates.md\n" +
      "  § The ignore list is a runtime constraint, not a preference.\n",
  );
  process.exit(1);
}
