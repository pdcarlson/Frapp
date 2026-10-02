#!/usr/bin/env node
// The repo's pinned EAS CLI, run as `npm run eas -- <command>` from the repo root (#3124).
//
// ONE VERSION, EVERYWHERE. CI's store build (`.github/workflows/_mobile-build.yml`, step
// "Install EAS CLI") installs eas-cli at an exact version with `--before=<date>` and
// `--ignore-scripts`. This script reads that line and installs the same thing, so a laptop runs
// the eas-cli CI runs, resolved the way CI resolves it, and a bump to the workflow moves both.
// It reads rather than copies because a second literal would drift; it throws rather than
// guessing because a failed parse that fell back to `eas-cli@latest` is the bug this replaces.
// `parseEasCliPin` is the one parse of that line: deploy-production-mobile.test.mjs uses it too.
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
// ONE DIRECTORY PER PIN. Each pin installs into its own `.cache/eas-cli/<pin>/`, built in a
// temporary directory and renamed into place only once it runs. So a bump never deletes a tree
// an eas command started before the bump is still loading from, two first runs at once can't
// interleave their installs, and an interrupted install is never mistaken for a finished one.
// Old pins' directories stay until someone deletes `.cache/eas-cli/`.
//
// WHERE IT RUNS. eas reads `app.json`, `app.config.js` and `eas.json` from its working
// directory, so the command always runs in `apps/mobile`, wherever npm was started. The
// script lives at the root because `npm run` inside a workspace (`apps/*`, `packages/*`) reads
// that workspace's own `package.json`, and `apps/mobile`'s is a frozen hotspot
// (`spec/ui/mobile/navigation.md` § Hotspot freeze).
//
// Node, not bash, so it also runs from Windows Git Bash, PowerShell or cmd: npm runs scripts
// through cmd.exe on Windows, where `bash -c` can resolve to WSL's bash or to nothing.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const MOBILE_BUILD_WORKFLOW = path.join(ROOT, ".github", "workflows", "_mobile-build.yml");
export const MOBILE_DIR = path.join(ROOT, "apps", "mobile");
export const CACHE_ROOT = path.join(ROOT, ".cache", "eas-cli");

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

/** This pin's own directory under the cache: a new version or cutoff is a new directory. */
export function pinDir({ version, before }, cacheRoot = CACHE_ROOT) {
  return path.join(cacheRoot, `${version}_before-${before}`);
}

/** The arguments to `npm`: CI's flags, into `dir` instead of the global prefix. */
export function installArgs({ version, before }, dir) {
  return ["install", "--prefix", dir, "--ignore-scripts", `--before=${before}`, "--no-audit", "--no-fund", `eas-cli@${version}`];
}

/**
 * The eas entry point an install holds, read from eas-cli's own `bin.eas`, or `null` when the
 * install is missing, another version, or names an entry that isn't there.
 */
export function easBin(dir, version) {
  try {
    const pkgDir = path.join(dir, "node_modules", "eas-cli");
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.eas;
    if (pkg.version !== version || !rel) return null;
    const bin = path.join(pkgDir, rel);
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/**
 * How to run npm without a shell. Under `npm run`, `npm_execpath` is npm's own CLI script.
 * Run directly, npm's CLI script is looked for where Node's installers put it beside `node`
 * (Windows: `<dir of node.exe>\node_modules\npm`; elsewhere: `<prefix>/lib/node_modules/npm`).
 * Only when neither is found is `npm` taken from PATH, which on Windows is `npm.cmd` and needs
 * a shell, so its arguments are quoted then.
 */
export function npmCommand({ env = process.env, platform = process.platform, execPath = process.execPath, exists = existsSync } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const candidates = [
    env.npm_execpath,
    p.join(p.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    p.join(p.dirname(execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = candidates.find((c) => c && /npm-cli\.js$/.test(c) && exists(c));
  if (cli) return { command: execPath, prefixArgs: [cli], shell: false };
  return { command: "npm", prefixArgs: [], shell: platform === "win32" };
}

/** cmd.exe quoting for the one case that goes through a shell. */
function shellQuote(arg) {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

/** Best effort: a leftover temporary tree costs disk, never correctness. */
function removeQuietly(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can refuse with EBUSY while an antivirus scan holds a file.
  }
}

function log(message) {
  process.stderr.write(`[eas-cli] ${message}\n`);
}

/**
 * Install the pin into its directory, or confirm another run already did. Returns the eas entry
 * point, or `null` after saying why it failed.
 */
export function install(pin, { cacheRoot = CACHE_ROOT, spawn = spawnSync, npm = npmCommand(), pid = process.pid } = {}) {
  const dir = pinDir(pin, cacheRoot);
  const tmp = `${dir}.tmp-${pid}`;
  log(`Installing eas-cli ${pin.version} (dependencies published before ${pin.before}) into ${path.relative(ROOT, dir) || dir}...`);
  try {
    removeQuietly(tmp);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, "package.json"), '{"name":"frapp-eas-cli","private":true}\n');
  } catch (err) {
    log(`ERROR: could not prepare ${tmp}: ${err.message}`);
    return null;
  }
  const args = [...npm.prefixArgs, ...installArgs(pin, tmp)];
  // npm's output goes to stderr, so `npm run -s eas -- … --json` keeps stdout to eas's JSON.
  const result = spawn(npm.command, npm.shell ? args.map(shellQuote) : args, {
    cwd: tmp,
    stdio: ["ignore", 2, 2],
    shell: npm.shell,
  });
  if (result.status !== 0 || !easBin(tmp, pin.version)) {
    log(
      `ERROR: installing eas-cli@${pin.version} failed (npm exited ${result.status ?? result.error?.message}). ` +
        "npm's output above says why.",
    );
    removeQuietly(tmp);
    return null;
  }
  try {
    renameSync(tmp, dir);
  } catch (err) {
    // Another run finished first and its tree is in place: use it, drop ours.
    removeQuietly(tmp);
    if (!easBin(dir, pin.version)) {
      log(`ERROR: could not move the install into ${dir}: ${err.message}`);
      return null;
    }
  }
  return easBin(dir, pin.version);
}

/** Run eas with `argv` in apps/mobile, installing the pin first if this machine lacks it. */
export function main(argv, { pin = readEasCliPin(), cacheRoot = CACHE_ROOT, spawn = spawnSync, installer = install } = {}) {
  const bin = easBin(pinDir(pin, cacheRoot), pin.version) ?? installer(pin, { cacheRoot, spawn });
  if (!bin) return 1;
  const result = spawn(process.execPath, [bin, ...argv], { cwd: MOBILE_DIR, stdio: "inherit" });
  if (result.error) {
    log(`ERROR: could not start eas: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
