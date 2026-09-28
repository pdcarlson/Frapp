import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Drives the REAL scripts/lib/node-toolchain.sh and .claude/hooks/session-start.sh against
// fake `node` binaries, a scratch FRAPP_NODE_DIR, and a fake `curl` that serves a local
// "nodejs.org" (a SHASUMS256.txt and a tar.xz holding a fake `bin/node`), so the whole
// install path (listing lookup, checksum, extract, swap) runs with no network and never
// touches the machine's own Node.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LIB = path.join(REPO_ROOT, "scripts/lib/node-toolchain.sh");
const HOOK = path.join(REPO_ROOT, ".claude/hooks/session-start.sh");
const SETUP = path.join(REPO_ROOT, "scripts/cloud-sandbox-setup.sh");
const BRINGUP = path.join(REPO_ROOT, "scripts/cloud-sandbox-up.sh");
const ARCH = { x64: "x64", arm64: "arm64" }[process.arch];

function fakeNode(dir, version) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "node"), `#!/bin/sh\necho v${version}\n`, {
    mode: 0o755,
  });
}

// Serves files from $FAKE_DIST by URL basename, as `curl -fsSL [-o out] URL`, and records
// every call in $FAKE_DIST/calls. A missing file is curl's -f failure, exit 22.
const FAKE_CURL = `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac
done
echo "$url" >> "$FAKE_DIST/calls"
f="$FAKE_DIST/$(basename "$url")"
[ -f "$f" ] || exit 22
if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi
`;

/**
 * A scratch dir with a repo root, a PATH dir (a fake node, the fake curl), a FRAPP_NODE_DIR,
 * and a fake dist. `dist` is the Node version the dist serves, or null for an empty one;
 * `badSum` lists a wrong checksum for it.
 */
function scratch(
  t,
  {
    engines = ">=24.9.0",
    pathNode = "22.22.2",
    cachedNode = null,
    dist = null,
    badSum = false,
  } = {},
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
  writeFileSync(path.join(bin, "curl"), FAKE_CURL, { mode: 0o755 });
  const nodeDir = path.join(dir, "node24");
  if (cachedNode) fakeNode(path.join(nodeDir, "bin"), cachedNode);
  const distDir = path.join(dir, "dist");
  mkdirSync(distDir);
  if (dist) {
    const name = `node-v${dist}-linux-${ARCH}`;
    fakeNode(path.join(distDir, "build", name, "bin"), dist);
    execFileSync("tar", [
      "-cJf",
      path.join(distDir, `${name}.tar.xz`),
      "-C",
      path.join(distDir, "build"),
      name,
    ]);
    const sum = badSum
      ? "0".repeat(64)
      : createHash("sha256")
          .update(readFileSync(path.join(distDir, `${name}.tar.xz`)))
          .digest("hex");
    writeFileSync(
      path.join(distDir, "SHASUMS256.txt"),
      `${"1".repeat(64)}  node-v${dist}-darwin-arm64.tar.gz\n${sum}  ${name}.tar.xz\n`,
    );
  }
  return {
    dir,
    root,
    bin,
    nodeDir,
    distDir,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      FRAPP_NODE_DIR: nodeDir,
      FAKE_DIST: distDir,
    },
  };
}

const curlCalls = (s) =>
  existsSync(path.join(s.distDir, "calls"))
    ? readFileSync(path.join(s.distDir, "calls"), "utf8").trim().split("\n")
    : [];

/** Source the lib, call ensure_node_toolchain, and report status, rc and the resolved node. */
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
    { env: s.env, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const result = Object.fromEntries(
    run.stdout
      .trim()
      .split(" ")
      .map((kv) => kv.split("=")),
  );
  return { ...result, stderr: run.stderr };
}

test("a Node on PATH that meets the floor is left alone", (t) => {
  const s = scratch(t, { pathNode: "24.10.0", cachedNode: "24.21.0" });
  const r = ensure(s);
  assert.equal(r.status, "ok");
  assert.equal(r.node, path.join(s.bin, "node"));
});

test("the floor compares versions, not strings: 24.10.0 meets >=24.9.0", (t) => {
  // A lexical compare puts "24.10.0" below "24.9.0" and would reinstall on every session.
  assert.equal(ensure(scratch(t, { pathNode: "24.10.0" })).status, "ok");
});

test("a cached install that meets the floor goes first on PATH, with no download", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", cachedNode: "24.21.0" });
  const r = ensure(s);
  assert.equal(r.status, "cached");
  assert.equal(r.node, path.join(s.nodeDir, "bin", "node"));
  assert.equal(r.version, "v24.21.0");
  assert.deepEqual(curlCalls(s), []);
});

test("with nothing cached, it installs the listed build for this arch and puts it on PATH", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", dist: "24.99.0" });
  const r = ensure(s);
  assert.equal(r.status, "installed", r.stderr);
  assert.equal(r.node, path.join(s.nodeDir, "bin", "node"));
  assert.equal(r.version, "v24.99.0");
  assert.deepEqual(curlCalls(s), [
    "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt",
    `https://nodejs.org/dist/latest-v24.x/node-v24.99.0-linux-${ARCH}.tar.xz`,
  ]);
});

test("an install below the floor is replaced in place, not nested, and no temp dir is left", (t) => {
  // Plain `mv new existing-dir` nests the new tree inside the old one and reports success.
  const s = scratch(t, {
    pathNode: "22.22.2",
    cachedNode: "24.1.0",
    dist: "24.99.0",
  });
  mkdirSync(`${s.nodeDir}.tmp.stale1`); // an interrupted earlier run's leftover
  const r = ensure(s);
  assert.equal(r.status, "installed", r.stderr);
  assert.equal(r.version, "v24.99.0");
  assert.ok(
    !existsSync(path.join(s.nodeDir, "node")),
    "the new tree must not nest in the old",
  );
  assert.deepEqual(
    readdirSync(s.dir).filter((f) => f.startsWith("node24.tmp")),
    [],
  );
});

test("a checksum mismatch installs nothing and keeps the previous install", (t) => {
  const s = scratch(t, {
    pathNode: "22.22.2",
    cachedNode: "24.1.0",
    dist: "24.99.0",
    badSum: true,
  });
  const r = ensure(s);
  assert.equal(r.status, "failed");
  assert.equal(r.rc, "1");
  assert.equal(
    r.node,
    path.join(s.bin, "node"),
    "PATH must not change when nothing meets the floor",
  );
  assert.match(r.stderr, /checksum mismatch/);
  assert.equal(
    execFileSync(path.join(s.nodeDir, "bin", "node"), {
      encoding: "utf8",
    }).trim(),
    "v24.1.0",
  );
});

test("an unreachable nodejs.org reports failed and says why", (t) => {
  const r = ensure(scratch(t, { pathNode: "22.22.2" }));
  assert.equal(r.status, "failed");
  assert.match(r.stderr, /could not reach https:\/\/nodejs\.org/);
});

test("no plain >=x.y.z floor means nothing to enforce", (t) => {
  assert.equal(ensure(scratch(t, { engines: null })).status, "skipped");
  assert.equal(ensure(scratch(t, { engines: "^24" })).status, "skipped");
  // A case glob took this as the floor "24.9.0 <25" and ignored the upper bound.
  assert.equal(
    ensure(scratch(t, { engines: ">=24.9.0 <25" })).status,
    "skipped",
  );
});

function runHook(s, { cloud = true, envFile = true } = {}) {
  const file = path.join(s.dir, "claude-env");
  writeFileSync(file, "");
  const env = {
    ...s.env,
    CLAUDE_PROJECT_DIR: s.root,
    FRAPP_CLOUD_MARKER: path.join(s.dir, "no-cloud-marker-here"),
  };
  if (envFile) env.CLAUDE_ENV_FILE = file;
  if (cloud) env.FRAPP_CLOUD_SANDBOX = "1";
  const run = spawnSync("bash", [HOOK], { env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const context = run.stdout
    ? JSON.parse(run.stdout).hookSpecificOutput.additionalContext
    : "";
  return { context, envFile: readFileSync(file, "utf8") };
}

test("the hook hands a cached Node to later commands through CLAUDE_ENV_FILE, silently", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", cachedNode: "24.21.0" });
  const { context, envFile } = runHook(s);
  assert.equal(envFile, `export PATH="${s.nodeDir}/bin:$PATH"\n`);
  assert.equal(context, "");
});

test("the hook never downloads: with nothing cached it still writes the PATH line and says bringup installs", (t) => {
  // Session start must not wait on nodejs.org; the PATH entry works once bringup fills it.
  const s = scratch(t, { pathNode: "22.22.2", dist: "24.99.0" });
  const { context, envFile } = runHook(s);
  assert.deepEqual(curlCalls(s), []);
  assert.equal(envFile, `export PATH="${s.nodeDir}/bin:$PATH"\n`);
  assert.match(context, /bringup is installing it/);
});

test("the hook says so when there is no CLAUDE_ENV_FILE to hand PATH over", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", cachedNode: "24.21.0" });
  const { context } = runHook(s, { envFile: false });
  assert.match(context, /could not hand .*\/bin to later commands/);
});

test("the hook writes nothing when PATH already satisfies the floor", (t) => {
  const { context, envFile } = runHook(scratch(t, { pathNode: "24.21.0" }));
  assert.equal(envFile, "");
  assert.equal(context, "");
});

test("the hook leaves a laptop's Node alone", (t) => {
  const s = scratch(t, { pathNode: "22.22.2", cachedNode: "24.21.0" });
  const { context, envFile } = runHook(s, { cloud: false });
  assert.equal(envFile, "");
  assert.equal(context, "");
});

// Order in the setup and bringup scripts. They start Docker and Supabase, so they are not run
// here; what matters is where the toolchain step sits relative to the npm and turbo runs.
test("setup puts Node on PATH before npm ci, so the cached tree is installed by it", () => {
  const src = readFileSync(SETUP, "utf8");
  const ensureAt = src.indexOf('ensure_node_toolchain "$ROOT"');
  assert.ok(ensureAt > 0);
  assert.ok(
    ensureAt < src.indexOf("\nnpm ci"),
    "ensure_node_toolchain must precede npm ci",
  );
});

test("bringup installs Node before the package build and reports a failure in both sentinels", () => {
  const src = readFileSync(BRINGUP, "utf8");
  const ensureAt = src.indexOf('ensure_node_toolchain "$ROOT"');
  assert.ok(ensureAt > 0);
  assert.ok(
    ensureAt < src.indexOf('turbo" run build'),
    "Node must be on PATH before turbo runs",
  );
  assert.match(src, /node_toolchain_warn" >>"\$FAILED_SENTINEL"/);
  assert.match(src, /node_toolchain_warn" >>"\$DONE_SENTINEL"/);
});
