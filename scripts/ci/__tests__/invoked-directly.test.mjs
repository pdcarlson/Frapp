import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { isInvokedDirectly } from "../lib/invoked-directly.mjs";

/**
 * Pins the entry-point guard every script under scripts/ uses (#2148).
 *
 * The bug it replaced: `` import.meta.url === `file://${process.argv[1]}` ``
 * is false on a path with a space or through a symlink, so a gate or deploy
 * step silently ran nothing and exited 0. The helper tests below show each
 * case false under that literal and true under the helper, and the tree lock
 * keeps every script on the helper.
 */

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const scriptsDir = join(repoRoot, "scripts");
const helperPath = join(scriptsDir, "ci", "lib", "invoked-directly.mjs");

/** The guard the 21 scripts carried until #2148. */
const oldLiteral = (importMetaUrl, entry) => importMetaUrl === `file://${entry}`;

function withTempDir(fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "invoked-directly-")));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the entry itself is invoked directly; another file is not", () => {
  withTempDir((dir) => {
    const script = join(dir, "script.mjs");
    const other = join(dir, "other.mjs");
    writeFileSync(script, "");
    writeFileSync(other, "");
    const url = pathToFileURL(script).href;
    assert.equal(isInvokedDirectly(url, script), true);
    assert.equal(isInvokedDirectly(url, other), false);
  });
});

test("no entry (node -e, a REPL) is never invoked directly", () => {
  // Not `undefined`: that selects the default, process.argv[1].
  assert.equal(isInvokedDirectly(import.meta.url, null), false);
  assert.equal(isInvokedDirectly(import.meta.url, ""), false);
});

test("a path with a space: the old literal is false, the helper is true", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, "my repo"));
    const script = join(dir, "my repo", "script.mjs");
    writeFileSync(script, "");
    const url = pathToFileURL(script).href;
    assert.match(url, /my%20repo/);
    assert.equal(oldLiteral(url, script), false);
    assert.equal(isInvokedDirectly(url, script), true);
  });
});

test("a symlinked checkout: the old literal is false, the helper is true", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, "real"));
    const script = join(dir, "real", "script.mjs");
    writeFileSync(script, "");
    symlinkSync(join(dir, "real"), join(dir, "link"));
    // Node realpath-resolves the entry's import.meta.url, but not argv[1].
    const url = pathToFileURL(script).href;
    const entry = join(dir, "link", "script.mjs");
    assert.equal(oldLiteral(url, entry), false);
    assert.equal(isInvokedDirectly(url, entry), true);
  });
});

test("when realpath throws, the fallback errs toward running", () => {
  withTempDir((dir) => {
    const url = pathToFileURL(join(dir, "gone", "script.mjs")).href;
    assert.equal(isInvokedDirectly(url, join(dir, "elsewhere", "script.mjs")), true);
    assert.equal(isInvokedDirectly(url, join(dir, "elsewhere", "other.mjs")), false);
  });
});

test("under real node, a script run through a space and a symlink still runs", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, "real dir"));
    const script = join(dir, "real dir", "entry.mjs");
    writeFileSync(
      script,
      `import { isInvokedDirectly } from ${JSON.stringify(pathToFileURL(helperPath).href)};\n` +
        `if (isInvokedDirectly(import.meta.url)) console.log("ran");\n`,
    );
    symlinkSync(join(dir, "real dir"), join(dir, "linked dir"));

    for (const entry of [script, join(dir, "linked dir", "entry.mjs")]) {
      const run = spawnSync(process.execPath, [entry], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout.trim(), "ran", `${entry} ran nothing`);
    }

    const imported = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(script).href)});`],
      { encoding: "utf8" },
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "", "importing the module must not run it");
  });
});

test("a deploy-path script reached through a symlinked checkout runs its CLI", () => {
  withTempDir((dir) => {
    const link = join(dir, "check out");
    symlinkSync(repoRoot, link);
    const env = { ...process.env };
    delete env.GITHUB_REPOSITORY;
    delete env.GITHUB_TOKEN;
    // Before #2148 this exited 0 having done nothing; now main() runs and
    // refuses for want of GITHUB_REPOSITORY.
    const run = spawnSync(
      process.execPath,
      [join(link, "scripts", "ci", "resolve-release-bump.mjs")],
      { encoding: "utf8", env, cwd: dir },
    );
    assert.equal(run.status, 1, `expected main() to run and fail; stderr: ${run.stderr}`);
    assert.match(run.stderr, /GITHUB_REPOSITORY/);
  });
});

function scriptFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scriptFiles(full));
    else if (/\.(?:[cm]?js|[cm]?ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("every script decides its entry point through isInvokedDirectly", () => {
  const files = scriptFiles(scriptsDir);
  assert.ok(files.length > 50, `walked only ${files.length} files; is scriptsDir right?`);

  const handRolled = files
    .filter((file) => file !== helperPath)
    .filter((file) => readFileSync(file, "utf8").includes("process.argv[1]"))
    .map((file) => relative(repoRoot, file));
  assert.deepEqual(
    handRolled,
    [],
    "These scripts read process.argv[1] themselves. Use isInvokedDirectly(import.meta.url) " +
      "from scripts/ci/lib/invoked-directly.mjs: its JSDoc says why every hand-rolled form " +
      "silently runs nothing on a path with a space or through a symlink.",
  );
});
