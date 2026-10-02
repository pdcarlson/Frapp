#!/usr/bin/env node
// The repo's pinned EAS CLI, run as `npm run eas -- <command>` from the repo root (#3124).
//
// ONE VERSION, EVERYWHERE. CI's store build (`.github/workflows/_mobile-build.yml`, step
// "Install EAS CLI") installs eas-cli at an exact version with `--before=<date>` and
// `--ignore-scripts`. This script reads that line and installs the same thing, so a laptop runs
// the eas-cli CI runs, resolved the way CI resolves it, and a bump to the workflow moves both.
// It reads rather than copies because a second literal would drift; it throws rather than
// guessing because a failed parse that fell back to `eas-cli@latest` is the bug this replaces.
// eas-cli-pin.test.mjs runs the parse against the real workflow.
//
// WHY A CACHE AND NOT A DEPENDENCY. eas-cli 24.8.0 is 527 packages and ~170 MB, with 21
// `npm audit` findings (9 high) on 2026-10-02. As a root devDependency it would land in every
// `npm ci` in CI and in the API image's dev-deps stage, trip ci.yml's audit gate, and bring
// its own `@expo/config`, `@expo/config-plugins` and `@expo/prebuild-config` into the root
// lockfile beside the Expo SDK's copies, the re-hoisting AGENTS.md § Gotchas warns about. A
// committed lockfile in a directory of its own would avoid those but raise the 21 findings as
// Dependabot alerts on a tool only a person at a laptop runs. So, like the Supabase CLI
// (`scripts/lib/supabase-cli.sh`), it installs into the gitignored `.cache/eas-cli/` on first
// use. Giving CI's install a lockfile is #3118.
//
// WHERE IT RUNS. eas reads `app.json`, `app.config.js` and `eas.json` from its working
// directory, so the command always runs in `apps/mobile`, wherever npm was started. The
// script lives at the root because `npm run` inside `apps/mobile` reads that workspace's own
// `package.json`, a frozen hotspot (`spec/ui/mobile/navigation.md` § Hotspot freeze).
//
// Node, not bash, so it also runs from Windows Git Bash, PowerShell or cmd: npm runs scripts
// through cmd.exe on Windows, where `bash -c` can resolve to WSL's bash or to nothing.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const MOBILE_BUILD_WORKFLOW = path.join(ROOT, ".github", "workflows", "_mobile-build.yml");
export const MOBILE_DIR = path.join(ROOT, "apps", "mobile");
export const CACHE_DIR = path.join(ROOT, ".cache", "eas-cli");

const INSTALL_LINE =
  /^\s+run: npm install --global --ignore-scripts --before=(\d{4}-\d{2}-\d{2}) eas-cli@(\d+\.\d+\.\d+)\s*$/gm;

/**
 * The exact version and `--before` cutoff of CI's eas-cli install. Throws unless the workflow
 * has exactly one such line, so a changed install can't silently leave this on `latest`.
 */
export function parseEasCliPin(workflowYaml) {
  const found = [...workflowYaml.matchAll(INSTALL_LINE)];
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one \`npm install --global --ignore-scripts --before=<date> eas-cli@<x.y.z>\` ` +
        `in ${path.relative(ROOT, MOBILE_BUILD_WORKFLOW)}, found ${found.length}. ` +
        "If CI's install changed shape, change parseEasCliPin with it.",
    );
  }
  const [, before, version] = found[0];
  return { version, before };
}

export function readEasCliPin({ readFile = readFileSync } = {}) {
  return parseEasCliPin(readFile(MOBILE_BUILD_WORKFLOW, "utf8"));
}

/** The arguments to `npm`: CI's flags, into the cache instead of the global prefix. */
export function installArgs({ version, before }, cacheDir = CACHE_DIR) {
  return [
    "install",
    "--prefix",
    cacheDir,
    "--ignore-scripts",
    `--before=${before}`,
    "--no-audit",
    "--no-fund",
    `eas-cli@${version}`,
  ];
}

/** What `.spec` records once an install has been proven: changes whenever either input does. */
export function specOf({ version, before }) {
  return `eas-cli@${version} --before=${before}`;
}

function installedVersion(cacheDir) {
  try {
    return JSON.parse(readFileSync(path.join(cacheDir, "node_modules", "eas-cli", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

function readSpec(cacheDir) {
  try {
    return readFileSync(path.join(cacheDir, ".spec"), "utf8");
  } catch {
    return null;
  }
}

/** Whether the cache already holds this pin, installed with these flags. */
export function cacheSatisfies(pin, cacheDir = CACHE_DIR) {
  return installedVersion(cacheDir) === pin.version && readSpec(cacheDir) === specOf(pin);
}

/**
 * How to run npm. Under `npm run`, `npm_execpath` is npm's own CLI script, run here with this
 * node; that works the same on every OS. Run directly, fall back to `npm` on PATH, which on
 * Windows is `npm.cmd` and needs a shell to start.
 */
export function npmCommand(env = process.env, platform = process.platform) {
  const execpath = env.npm_execpath;
  if (execpath && /npm-cli\.js$/.test(execpath)) {
    return { command: process.execPath, prefixArgs: [execpath], shell: false };
  }
  return { command: "npm", prefixArgs: [], shell: platform === "win32" };
}

function log(message) {
  process.stderr.write(`[eas-cli] ${message}\n`);
}

function install(pin) {
  log(`Installing eas-cli ${pin.version} (dependencies published before ${pin.before}) into .cache/eas-cli/...`);
  // A clean tree each time: an old lockfile in the cache would hold the dependencies at the
  // previous pin's versions, and the point is to resolve exactly as CI does.
  rmSync(CACHE_DIR, { recursive: true, force: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path.join(CACHE_DIR, "package.json"), '{"name":"frapp-eas-cli","private":true}\n');
  const npm = npmCommand();
  // npm's output goes to stderr, so `npm run -s eas -- … --json` keeps stdout to eas's JSON.
  const result = spawnSync(npm.command, [...npm.prefixArgs, ...installArgs(pin)], {
    cwd: CACHE_DIR,
    stdio: ["ignore", 2, 2],
    shell: npm.shell,
  });
  if (result.status !== 0 || installedVersion(CACHE_DIR) !== pin.version) {
    log(
      `ERROR: installing eas-cli@${pin.version} failed (npm exited ${result.status ?? result.error?.message}). ` +
        "npm's output above says why.",
    );
    return false;
  }
  // Recorded only after the install is proven, so a half-installed tree never counts as current.
  writeFileSync(path.join(CACHE_DIR, ".spec"), specOf(pin));
  return true;
}

function main(argv) {
  const pin = readEasCliPin();
  if (!cacheSatisfies(pin) && !install(pin)) return 1;
  const bin = path.join(CACHE_DIR, "node_modules", "eas-cli", "bin", "run");
  if (!existsSync(MOBILE_DIR)) {
    log(`ERROR: ${MOBILE_DIR} is missing; eas has no project to run against.`);
    return 1;
  }
  const result = spawnSync(process.execPath, [bin, ...argv], { cwd: MOBILE_DIR, stdio: "inherit" });
  if (result.error) {
    log(`ERROR: could not start eas: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
