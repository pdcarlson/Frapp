import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Drives the REAL scripts/lib/node-toolchain.sh and .claude/hooks/session-start.sh against
// fake `node` binaries, a scratch FRAPP_NODE_DIR, and a `curl` that always fails, so nothing
// here touches the network or the machine's own Node. The download itself (nodejs.org,
// checksum, extract) is not exercised: a test that needs the network is a test CI can't run.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LIB = path.join(REPO_ROOT, "scripts/lib/node-toolchain.sh");
const HOOK = path.join(REPO_ROOT, ".claude/hooks/session-start.sh");

function fakeNode(dir, version) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "node"), `#!/bin/sh\necho v${version}\n`, {
    mode: 0o755,
  });
}

/** A scratch dir with a repo root, a PATH dir holding a failing curl, and a FRAPP_NODE_DIR. */
function scratch(
  t,
  { engines = ">=24.9.0", pathNode = "22.22.2", cachedNode = null } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), "node-toolchain-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "repo");
  mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  copyFileSync(LIB, path.join(root, "scripts", "lib", "node-toolchain.sh"));
  if (engines !== null) {
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ engines: { node: engines } }),
    );
  }
  const bin = path.join(dir, "bin");
  if (pathNode) fakeNode(bin, pathNode);
  else mkdirSync(bin);
  writeFileSync(path.join(bin, "curl"), "#!/bin/sh\nexit 22\n", {
    mode: 0o755,
  });
  const nodeDir = path.join(dir, "node24");
  if (cachedNode) fakeNode(path.join(nodeDir, "bin"), cachedNode);
  return { dir, root, bin, nodeDir, PATH: `${bin}:/usr/bin:/bin` };
}

/** Source the lib, call ensure_node_toolchain, and print status, rc and resolved node. */
function ensure(s) {
  const run = spawnSync(
    "bash",
    [
      "-c",
      `. "$1/scripts/lib/node-toolchain.sh"; rc=0; ensure_node_toolchain "$1" || rc=$?; ` +
        `echo "status=$NODE_TOOLCHAIN_STATUS rc=$rc node=$(command -v node) version=$(node --version 2>/dev/null)"`,
      "_",
      s.root,
    ],
    { env: { PATH: s.PATH, FRAPP_NODE_DIR: s.nodeDir }, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  return Object.fromEntries(
    run.stdout
      .trim()
      .split(" ")
      .map((kv) => kv.split("=")),
  );
}

test("a Node on PATH that meets the floor is left alone", (t) => {
  const s = scratch(t, { pathNode: "24.10.0", cachedNode: "24.21.0" });
  const r = ensure(s);
  assert.equal(r.status, "ok");
  assert.equal(r.node, path.join(s.bin, "node"));
});

test("the floor compares versions, not strings: 24.10.0 meets >=24.9.0", (t) => {
  // A lexical compare puts "24.10.0" below "24.9.0" and would reinstall on every session.
  const r = ensure(scratch(t, { pathNode: "24.10.0" }));
  assert.equal(r.status, "ok");
});

test("a cached install that meets the floor goes first on PATH", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", cachedNode: "24.21.0" });
  const r = ensure(s);
  assert.equal(r.status, "cached");
  assert.equal(r.node, path.join(s.nodeDir, "bin", "node"));
  assert.equal(r.version, "v24.21.0");
});

test("a cached install below the floor is not used, and a failed download reports failed", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", cachedNode: "24.1.0" });
  const r = ensure(s);
  assert.equal(r.status, "failed");
  assert.equal(r.rc, "1");
  assert.equal(
    r.node,
    path.join(s.bin, "node"),
    "PATH must not change when nothing satisfies the floor",
  );
  assert.ok(
    existsSync(path.join(s.nodeDir, "bin", "node")),
    "a failed download must not delete the old install",
  );
});

test("no readable floor means nothing to enforce", (t) => {
  assert.equal(ensure(scratch(t, { engines: null })).status, "skipped");
  assert.equal(ensure(scratch(t, { engines: "^24" })).status, "skipped");
});

function runHook(s, { cloud = true } = {}) {
  const envFile = path.join(s.dir, "claude-env");
  writeFileSync(envFile, "");
  const env = {
    PATH: s.PATH,
    FRAPP_NODE_DIR: s.nodeDir,
    CLAUDE_PROJECT_DIR: s.root,
    CLAUDE_ENV_FILE: envFile,
    FRAPP_CLOUD_MARKER: path.join(s.dir, "no-cloud-marker-here"),
  };
  if (cloud) env.FRAPP_CLOUD_SANDBOX = "1";
  const run = spawnSync("bash", [HOOK], { env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return { stdout: run.stdout, envFile: readFileSync(envFile, "utf8") };
}

test("the hook hands a cached Node to the session's later commands through CLAUDE_ENV_FILE", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", cachedNode: "24.21.0" });
  const { envFile } = runHook(s);
  assert.equal(envFile, `export PATH="${s.nodeDir}/bin:$PATH"\n`);
});

test("the hook writes nothing when PATH already satisfies the floor", (t) => {
  const s = scratch(t, { pathNode: "24.21.0" });
  const { stdout, envFile } = runHook(s);
  assert.equal(envFile, "");
  assert.equal(stdout, "");
});

test("the hook tells the session when no Node meets the floor, and still exits 0", (t) => {
  const s = scratch(t, { pathNode: "22.22.2" });
  const { stdout, envFile } = runHook(s);
  assert.equal(envFile, "");
  const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
  assert.match(
    context,
    /node on PATH is v22\.22\.2, below package\.json engines\.node/,
  );
});

test("the hook leaves a laptop's Node alone", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", cachedNode: "24.21.0" });
  const { stdout, envFile } = runHook(s, { cloud: false });
  assert.equal(envFile, "");
  assert.equal(stdout, "");
});
