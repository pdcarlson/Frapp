import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CACHE_DIR,
  MOBILE_DIR,
  cacheSatisfies,
  installArgs,
  npmCommand,
  parseEasCliPin,
  readEasCliPin,
  specOf,
} from "../../eas.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const step = (line) =>
  ["jobs:", "  build:", "    steps:", "      - name: Install EAS CLI", `        run: ${line}`].join("\n");
const CI_LINE = "npm install --global --ignore-scripts --before=2026-10-01 eas-cli@24.8.0";

// ── One version, read from CI's install (#3124) ─────────────────────────────

test("reads the version and cutoff from CI's one eas-cli install line", () => {
  assert.deepEqual(parseEasCliPin(step(CI_LINE)), { version: "24.8.0", before: "2026-10-01" });
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

test("installs with CI's flags into the gitignored cache, never globally", () => {
  const args = installArgs({ version: "24.8.0", before: "2026-10-01" });
  assert.equal(args[0], "install");
  assert.deepEqual(args.slice(1, 3), ["--prefix", CACHE_DIR]);
  for (const flag of ["--ignore-scripts", "--before=2026-10-01", "eas-cli@24.8.0"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.ok(!args.includes("--global") && !args.includes("-g"), "a laptop install stays out of the global prefix");
  assert.equal(relative(REPO, CACHE_DIR), join(".cache", "eas-cli"));
  assert.match(readFileSync(join(REPO, ".gitignore"), "utf8"), /^\/\.cache\/$/m, ".cache/ must stay ignored");
});

test("eas runs in apps/mobile, where its app.json and eas.json are", () => {
  assert.equal(relative(REPO, MOBILE_DIR), join("apps", "mobile"));
  assert.ok(statSync(join(MOBILE_DIR, "eas.json")).isFile());
});

test("`npm run eas` is the root script, so it works from a fresh `npm ci`", () => {
  const { scripts } = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.equal(scripts.eas, "node scripts/eas.mjs");
  const mobile = JSON.parse(readFileSync(join(REPO, "apps", "mobile", "package.json"), "utf8"));
  assert.equal(mobile.scripts?.eas, undefined, "one entry point: from the repo root");
});

// ── The cache ───────────────────────────────────────────────────────────────

function fakeCache({ version, spec }) {
  const dir = mkdtempSync(join(tmpdir(), "eas-cli-cache-"));
  if (version) {
    mkdirSync(join(dir, "node_modules", "eas-cli"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "eas-cli", "package.json"), JSON.stringify({ version }));
  }
  if (spec) writeFileSync(join(dir, ".spec"), spec);
  return dir;
}

test("the cache is reused only when it holds this version, installed with this cutoff", () => {
  const pin = { version: "24.8.0", before: "2026-10-01" };
  const cases = [
    [{ version: "24.8.0", spec: specOf(pin) }, true],
    [{ version: "24.8.0" }, false], // installed, never proven: a half-finished install
    [{ version: "24.7.0", spec: specOf(pin) }, false],
    [{ version: "24.8.0", spec: specOf({ ...pin, before: "2026-09-25" }) }, false],
    [{}, false],
  ];
  for (const [state, expected] of cases) {
    const dir = fakeCache(state);
    try {
      assert.equal(cacheSatisfies(pin, dir), expected, JSON.stringify(state));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("npm is run through npm's own CLI under `npm run`, and through a shell only for Windows' npm.cmd", () => {
  const viaNpm = npmCommand({ npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js" }, "linux");
  assert.deepEqual(viaNpm, {
    command: process.execPath,
    prefixArgs: ["/usr/lib/node_modules/npm/bin/npm-cli.js"],
    shell: false,
  });
  assert.equal(npmCommand({ npm_execpath: "C:\\npm\\bin\\npm-cli.js" }, "win32").shell, false);
  assert.deepEqual(npmCommand({}, "linux"), { command: "npm", prefixArgs: [], shell: false });
  assert.deepEqual(npmCommand({}, "win32"), { command: "npm", prefixArgs: [], shell: true });
  // Another package manager's execpath is not npm's CLI.
  assert.equal(npmCommand({ npm_execpath: "/usr/lib/node_modules/pnpm/bin/pnpm.cjs" }, "linux").command, "npm");
});

// ── The docs say `npm run eas -- …` ─────────────────────────────────────────
//
// A bare `eas …` in a runnable block works only where someone already installed eas-cli
// globally, at whatever version they happened to get: the failure #3124 records
// (`bash: eas: command not found`). Prose that names a subcommand (what CI runs, what a flag
// does) is not a command to type, so only fenced code is checked.

function markdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
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
  for (const top of ["docs", "spec", ".claude", ".github", join("apps", "mobile")]) {
    for (const file of markdownFiles(join(REPO, top))) {
      for (const hit of bareEasInFences(readFileSync(file, "utf8"))) {
        offenders.push(`${relative(REPO, file)}:${hit.line}: ${hit.text}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "write `npm run eas -- <command>` (from the repo root)");
});
