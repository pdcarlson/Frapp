import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CACHE_ROOT,
  MOBILE_DIR,
  easBin,
  install,
  installArgs,
  main,
  npmCommand,
  renameWithRetry,
  parseEasCliPin,
  pinDir,
  readEasCliPin,
} from "../../eas.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const step = (line) =>
  ["jobs:", "  build:", "    steps:", "      - name: Install EAS CLI", `        run: ${line}`].join("\n");
const CI_LINE = "npm install --global --ignore-scripts --before=2026-10-01 eas-cli@24.8.0";
const PIN = { version: "24.8.0", before: "2026-10-01" };

// ── One version, read from CI's install (#3124) ─────────────────────────────

test("reads the version and cutoff from CI's one eas-cli install line", () => {
  assert.deepEqual(parseEasCliPin(step(CI_LINE)), PIN);
  const real = readEasCliPin();
  assert.match(real.version, /^\d+\.\d+\.\d+$/, "the real workflow parses");
  assert.match(real.before, /^\d{4}-\d{2}-\d{2}$/);
});

// An unparsed install must stop the script: falling back would install `latest`.
test("refuses a missing, non-exact, unfrozen or duplicated install rather than guessing", () => {
  assert.throws(() => parseEasCliPin("jobs: {}\n"), /found 0/);
  assert.throws(() => parseEasCliPin(step(CI_LINE.replace("24.8.0", "latest"))), /found 0/);
  assert.throws(() => parseEasCliPin(step(CI_LINE.replace("24.8.0", "^24.8.0"))), /found 0/);
  assert.throws(() => parseEasCliPin(step(CI_LINE.replace(" --before=2026-10-01", ""))), /found 0/);
  assert.throws(() => parseEasCliPin(`${step(CI_LINE)}\n${step(CI_LINE)}`), /found 2/);
  // A comment naming the command is not the install.
  assert.throws(() => parseEasCliPin(`      # run: ${CI_LINE}\n`), /found 0/);
});

test("installs with CI's flags into the pin's own gitignored directory, never globally", () => {
  const dir = pinDir(PIN);
  assert.equal(relative(REPO, dir), join(".cache", "eas-cli", "24.8.0_before-2026-10-01"));
  assert.notEqual(pinDir({ ...PIN, before: "2026-09-25" }), dir, "a new cutoff is a new directory");
  const args = installArgs(PIN, dir);
  assert.equal(args[0], "install");
  assert.deepEqual(args.slice(1, 3), ["--prefix", dir]);
  // --loglevel=error: `npm run -s` would otherwise silence the reason an install failed.
  for (const flag of ["--ignore-scripts", "--before=2026-10-01", "--loglevel=error", "eas-cli@24.8.0"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.ok(!args.includes("--global") && !args.includes("-g"), "a laptop install stays out of the global prefix");
  assert.equal(relative(REPO, CACHE_ROOT), join(".cache", "eas-cli"));
  assert.match(readFileSync(join(REPO, ".gitignore"), "utf8"), /^\/\.cache\/$/m, ".cache/ must stay ignored");
});

test("the store-build section cites the version and cutoff CI installs", () => {
  const doc = readFileSync(join(REPO, "docs", "ops", "deployment", "mobile.md"), "utf8");
  const { version, before } = readEasCliPin();
  const m = doc.match(/installs eas-cli\s+\*\*(\S+)\*\* with `--before=(\S+)`/);
  assert.ok(m, "mobile.md's store-build steps name the pinned eas-cli");
  assert.deepEqual({ version: m[1], before: m[2] }, { version, before }, "move mobile.md with CI's install line");
});

test("`npm run eas` is the root script, so it works from a fresh `npm ci`", () => {
  const { scripts } = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.equal(scripts.eas, "node scripts/eas.mjs");
  const mobile = JSON.parse(readFileSync(join(REPO, "apps", "mobile", "package.json"), "utf8"));
  assert.equal(mobile.scripts?.eas, undefined, "one entry point: from the repo root");
  assert.ok(statSync(join(MOBILE_DIR, "eas.json")).isFile(), "eas runs where its eas.json is");
});

// ── The cache, the install and the run ──────────────────────────────────────

/** A fake eas-cli install in `dir`, as npm would leave it. */
function fakeInstall(dir, { version = PIN.version, bin = { eas: "./bin/run" }, writeBin = true } = {}) {
  const pkg = join(dir, "node_modules", "eas-cli");
  mkdirSync(join(pkg, "bin"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ version, bin }));
  if (writeBin) writeFileSync(join(pkg, "bin", "run"), "");
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "eas-cli-cache-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an install counts only when it is this version and its own bin entry exists", () =>
  withTmp((root) => {
    const at = (name, opts) => {
      const dir = join(root, name);
      fakeInstall(dir, opts);
      return easBin(dir, PIN.version);
    };
    assert.equal(at("ok"), join(root, "ok", "node_modules", "eas-cli", "bin", "run"));
    assert.equal(at("other-version", { version: "24.7.0" }), null);
    assert.equal(at("bin-moved", { bin: { eas: "./bin/run.js" } }), null, "read from bin.eas, and it must exist");
    assert.equal(at("no-bin-file", { writeBin: false }), null);
    assert.equal(easBin(join(root, "absent"), PIN.version), null);
  }));

/** A spawn double: records each call, and for npm, lays down a fake install at --prefix. */
function fakeSpawn({ npmStatus = 0, easStatus = 0, installs = true } = {}) {
  const calls = [];
  const spawn = (command, args, opts) => {
    calls.push({ command, args, opts });
    const prefix = args.indexOf("--prefix");
    if (prefix !== -1) {
      if (installs && npmStatus === 0) fakeInstall(args[prefix + 1]);
      return { status: npmStatus };
    }
    return { status: easStatus };
  };
  return { spawn, calls };
}
const npm = { command: "npm-for-test", prefixArgs: [], shell: false };

test("first use installs into a temporary directory, renames it into place, then runs eas in apps/mobile", () =>
  withTmp((cacheRoot) => {
    const { spawn, calls } = fakeSpawn({ easStatus: 3 });
    const status = main(["build", "--json"], {
      pin: PIN,
      cacheRoot,
      spawn,
      installer: (pin, o) => install(pin, { ...o, npm, pid: 42 }),
    });
    assert.equal(calls.length, 2);
    const [installCall, easCall] = calls;
    assert.equal(installCall.opts.cwd, `${pinDir(PIN, cacheRoot)}.tmp-42`, "built beside the final directory");
    assert.deepEqual(installCall.opts.stdio, ["ignore", 2, 2], "npm's output stays off stdout, so --json output is clean");
    assert.equal(easCall.command, process.execPath);
    assert.deepEqual(easCall.args, [easBin(pinDir(PIN, cacheRoot), PIN.version), "build", "--json"]);
    assert.equal(easCall.opts.cwd, MOBILE_DIR, "eas reads app.json and eas.json from its working directory");
    assert.equal(easCall.opts.stdio, "inherit");
    assert.equal(status, 3, "eas's exit status is the script's");
  }));

test("a pin already installed runs without npm", () =>
  withTmp((cacheRoot) => {
    fakeInstall(pinDir(PIN, cacheRoot));
    const { spawn, calls } = fakeSpawn();
    const installer = () => assert.fail("must not reinstall a pin that is in place");
    assert.equal(main(["whoami"], { pin: PIN, cacheRoot, spawn, installer }), 0);
    assert.equal(calls.length, 1);
  }));

test("a failed install runs nothing, and leaves no directory that would count as installed", () =>
  withTmp((cacheRoot) => {
    for (const fail of [{ npmStatus: 1 }, { installs: false }]) {
      const { spawn, calls } = fakeSpawn(fail);
      const status = main(["whoami"], { pin: PIN, cacheRoot, spawn, installer: (pin, o) => install(pin, { ...o, npm }) });
      assert.equal(status, 1, JSON.stringify(fail));
      assert.equal(calls.length, 1, "eas never starts");
      // Not merely "doesn't count": a tree renamed into place would block every later install.
      assert.throws(() => statSync(pinDir(PIN, cacheRoot)), /ENOENT/, JSON.stringify(fail));
    }
  }));

test("a pin directory damaged after the fact is replaced, not left to fail every run", () =>
  withTmp((cacheRoot) => {
    fakeInstall(pinDir(PIN, cacheRoot), { writeBin: false }); // say, a quarantined bin/run
    const { spawn } = fakeSpawn();
    const bin = install(PIN, { cacheRoot, spawn, npm, pid: 9 });
    assert.equal(bin, join(pinDir(PIN, cacheRoot), "node_modules", "eas-cli", "bin", "run"));
    assert.throws(() => statSync(`${pinDir(PIN, cacheRoot)}.broken-9`), /ENOENT/);
  }));

test("an install that died leaves a temporary tree the next install removes, unless its run is still alive", () =>
  withTmp((cacheRoot) => {
    const dead = `${pinDir(PIN, cacheRoot)}.tmp-4194303`;
    const live = `${pinDir(PIN, cacheRoot)}.tmp-${process.pid}`;
    for (const d of [dead, live]) mkdirSync(d, { recursive: true });
    const { spawn } = fakeSpawn();
    install(PIN, { cacheRoot, spawn, npm, pid: 11 });
    assert.throws(() => statSync(dead), /ENOENT/);
    assert.ok(statSync(live).isDirectory(), "a running install's tree is not touched");
  }));

test("the rename into place waits out Windows' transient refusals, and nothing else", () => {
  const failing = (codes) => {
    let n = 0;
    return () => {
      if (n < codes.length) {
        const err = new Error(codes[n]);
        err.code = codes[n++];
        throw err;
      }
    };
  };
  const waits = [];
  renameWithRetry("a", "b", { rename: failing(["EPERM", "EBUSY", "EACCES"]), wait: (ms) => waits.push(ms) });
  assert.deepEqual(waits, [100, 200, 300]);
  assert.throws(() => renameWithRetry("a", "b", { rename: failing(["ENOTEMPTY"]), wait: () => assert.fail("no retry") }), /ENOTEMPTY/);
  assert.throws(() => renameWithRetry("a", "b", { rename: failing(Array(10).fill("EPERM")), wait: () => {} }), /EPERM/);
});

test("when another run finished the install first, its tree is used and ours is dropped", () =>
  withTmp((cacheRoot) => {
    const { spawn } = fakeSpawn();
    const racing = (command, args, opts) => {
      const result = spawn(command, args, opts);
      fakeInstall(pinDir(PIN, cacheRoot)); // the other run's rename lands first
      return result;
    };
    const bin = install(PIN, { cacheRoot, spawn: racing, npm, pid: 7 });
    assert.equal(bin, easBin(pinDir(PIN, cacheRoot), PIN.version));
    assert.throws(() => statSync(`${pinDir(PIN, cacheRoot)}.tmp-7`), /ENOENT/);
  }));

test("npm is run as node plus npm's own CLI script whenever one is found, and through a shell only as a last resort", () => {
  const cli = "/usr/lib/node_modules/npm/bin/npm-cli.js";
  const has = (...paths) => (p) => paths.includes(p);
  assert.deepEqual(npmCommand({ env: { npm_execpath: cli }, platform: "linux", execPath: "/usr/bin/node", exists: has(cli) }), {
    command: "/usr/bin/node",
    prefixArgs: [cli],
    shell: false,
  });
  // Run directly on Windows: npm's CLI beside node.exe, no shell, so a path with a space survives.
  const winCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const win = npmCommand({ env: {}, platform: "win32", execPath: "C:\\Program Files\\nodejs\\node.exe", exists: has(winCli) });
  assert.deepEqual(win, { command: "C:\\Program Files\\nodejs\\node.exe", prefixArgs: [winCli], shell: false });
  // Run directly elsewhere: <prefix>/lib/node_modules/npm beside <prefix>/bin/node.
  const unixCli = "/opt/node/lib/node_modules/npm/bin/npm-cli.js";
  assert.deepEqual(npmCommand({ env: {}, platform: "linux", execPath: "/opt/node/bin/node", exists: has(unixCli) }).prefixArgs, [
    unixCli,
  ]);
  // Another package manager's execpath, or a missing file, is not npm's CLI.
  const none = { execPath: "/x/node", exists: () => false };
  assert.deepEqual(npmCommand({ ...none, env: { npm_execpath: "/x/pnpm.cjs" }, platform: "linux" }), {
    command: "npm",
    prefixArgs: [],
    shell: false,
  });
  assert.equal(npmCommand({ ...none, env: {}, platform: "win32" }).shell, true);
});

test("the shell fallback quotes a path with a space", () =>
  withTmp((root) => {
    const cacheRoot = join(root, "Jane Doe");
    const { spawn, calls } = fakeSpawn({ installs: false });
    install(PIN, { cacheRoot, spawn, npm: { command: "npm", prefixArgs: [], shell: true } });
    const prefix = calls[0].args[calls[0].args.indexOf("--prefix") + 1];
    assert.equal(prefix, `"${pinDir(PIN, cacheRoot)}.tmp-${process.pid}"`);
  }));

// ── The docs say `npm run eas -- …` ─────────────────────────────────────────
//
// A bare `eas …` in a runnable block works only where someone already installed eas-cli
// globally, at whatever version they happened to get: the failure #3124 records
// (`bash: eas: command not found`). Only fenced code is checked. Inline code is where these
// docs name a subcommand in prose (what CI's own global `eas` runs, what a flag does, how a
// status was read), and a rule that told those from an inline instruction would be a guess, so
// the inline instructions (the submit and credentials steps, the store README's env:list) were
// moved by hand in #3124 and are left to review. A git pathspec's `*` crosses `/`, so
// `docs/*.md` is every tracked doc under docs/.

/** Tracked Markdown only: a nested worktree or other untracked copy isn't this checkout's docs. */
function trackedMarkdown(...pathspecs) {
  return execFileSync("git", ["ls-files", "-z", "--", ...pathspecs.map((p) => `${p}/*.md`)], { cwd: REPO, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

const BARE_EAS = /^\s*(?:\$\s*)?(?:npx\s+)?eas\s+\S/;

function bareEasInFences(markdown) {
  const hits = [];
  let fenced = false;
  markdown.split("\n").forEach((line, i) => {
    if (/^\s*(?:>\s*)?```/.test(line)) {
      fenced = !fenced;
      return;
    }
    const code = line.replace(/^\s*>\s?/, "");
    if (fenced && !/^\s*#/.test(code) && BARE_EAS.test(code)) hits.push({ line: i + 1, text: line.trim() });
  });
  return hits;
}

test("the scan catches a bare eas command in a fence and ignores prose, comments and the pinned form", () => {
  const md = [
    "Run `eas build` in prose.",
    "```bash",
    "eas login",
    "  eas env:set --environment $ENV \\",
    "npx eas build --profile preview",
    "# eas init, never",
    "npm run eas -- whoami",
    "```",
    "> ```bash",
    "> eas submit -p ios --latest",
    "> ```",
  ].join("\n");
  assert.deepEqual(
    bareEasInFences(md).map((h) => h.line),
    [3, 4, 5, 10],
  );
});

test("no doc, spec or skill tells anyone to run a bare `eas` command", () => {
  const offenders = [];
  const files = trackedMarkdown("docs", "spec", ".claude", ".github", "apps/mobile");
  assert.ok(files.includes("docs/ops/deployment/mobile.md"), "the scan sees the EAS setup doc");
  for (const file of files) {
    for (const hit of bareEasInFences(readFileSync(join(REPO, file), "utf8"))) {
      offenders.push(`${file}:${hit.line}: ${hit.text}`);
    }
  }
  assert.deepEqual(offenders, [], "write `npm run eas -- <command>` (from the repo root)");
});
