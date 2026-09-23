import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Drives the REAL .claude/hooks/session-start.sh, not a copy of its logic: each case builds a
// scratch git repo, a scratch bringup lock and log, and a fake boot id file, points the hook at
// them through the variables it reads, and checks what it did. A stub `cloud-sandbox-up.sh`
// stands in for bringup and only records that it was launched.

const HOOK = fileURLToPath(new URL("../../../.claude/hooks/session-start.sh", import.meta.url));

function scratch(t, { prePush = true, bringup = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "session-start-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "repo");
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  if (prePush) {
    mkdirSync(path.join(root, ".githooks"));
    writeFileSync(path.join(root, ".githooks", "pre-push"), "#!/usr/bin/env bash\nexit 0\n");
  }
  const launched = path.join(dir, "launched");
  if (bringup) {
    mkdirSync(path.join(root, "scripts"));
    writeFileSync(path.join(root, "scripts", "cloud-sandbox-up.sh"), `touch ${JSON.stringify(launched)}\n`);
  }
  return {
    dir,
    root,
    launched,
    lock: path.join(dir, "cloud-sandbox-up.lock"),
    log: path.join(dir, "cloud-sandbox-up.log"),
    bootFile: path.join(dir, "boot_id"),
  };
}

/** Run the hook; `boot` is the current boot id, or null for a host that exposes none. */
function runHook(s, { boot = "boot-B", cloud = true } = {}) {
  if (boot !== null) writeFileSync(s.bootFile, `${boot}\n`);
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: s.root,
    FRAPP_BRINGUP_LOCK: s.lock,
    FRAPP_BRINGUP_LOG: s.log,
    FRAPP_BOOT_ID_FILE: boot === null ? path.join(s.dir, "no-boot-id-here") : s.bootFile,
  };
  if (cloud) env.FRAPP_CLOUD_SANDBOX = "1";
  else delete env.FRAPP_CLOUD_SANDBOX;
  const run = spawnSync("bash", [HOOK], { env, encoding: "utf8" });
  assert.equal(run.status, 0, `hook exited ${run.status}: ${run.stderr}`);
  return run.stdout.trim() ? JSON.parse(run.stdout).hookSpecificOutput.additionalContext : "";
}

/** A lock left by an earlier bringup, as launch_bringup writes it. */
function priorLock(s, { boot, sentinel = ".cloud-sandbox-up.done" } = {}) {
  mkdirSync(s.lock);
  writeFileSync(path.join(s.lock, "pid"), "999999\n");
  if (boot !== undefined) writeFileSync(path.join(s.lock, "boot_id"), `${boot}\n`);
  if (sentinel) writeFileSync(path.join(s.root, sentinel), "2026-09-23T01:46:36Z\n");
}

const hooksPath = (s) =>
  spawnSync("git", ["-C", s.root, "config", "--get", "core.hooksPath"], { encoding: "utf8" }).stdout.trim();

async function eventually(check, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

// ── The review gate (#2488) ─────────────────────────────────────────────────

test("arms the review gate in a checkout that never ran npm ci, cloud or not", (t) => {
  const s = scratch(t, { bringup: false });
  assert.equal(hooksPath(s), "", "precondition: a fresh clone has no hooksPath");
  runHook(s, { cloud: false });
  assert.equal(hooksPath(s), ".githooks");
});

test("leaves a hooksPath that already names the hooks directory as it is", (t) => {
  const s = scratch(t, { bringup: false });
  const absolute = path.join(s.root, ".githooks");
  execFileSync("git", ["-C", s.root, "config", "core.hooksPath", absolute]);
  runHook(s, { cloud: false });
  assert.equal(hooksPath(s), absolute);
});

test("points a hooksPath naming some other directory back at .githooks, as npm ci would", (t) => {
  const s = scratch(t, { bringup: false });
  execFileSync("git", ["-C", s.root, "config", "core.hooksPath", "/somewhere/else"]);
  runHook(s, { cloud: false });
  assert.equal(hooksPath(s), ".githooks");
});

test("sets nothing in a checkout with no committed pre-push hook", (t) => {
  const s = scratch(t, { prePush: false, bringup: false });
  runHook(s, { cloud: false });
  assert.equal(hooksPath(s), "");
});

test("arms the gate before bringup, so a (dependencies) sentinel no longer means an open gate", (t) => {
  const s = scratch(t);
  priorLock(s, { boot: "boot-B", sentinel: ".cloud-sandbox-up.failed" });
  runHook(s, { boot: "boot-B" });
  assert.equal(hooksPath(s), ".githooks");
});

// ── A lock from before a restart (#2515) ────────────────────────────────────

for (const sentinel of [".cloud-sandbox-up.done", ".cloud-sandbox-up.failed"]) {
  test(`a lock and ${sentinel} from an earlier boot relaunch bringup and say so`, async (t) => {
    const s = scratch(t);
    priorLock(s, { boot: "boot-A", sentinel });
    const context = runHook(s, { boot: "boot-B" });
    assert.match(context, /this machine restarted since the last bringup/);
    assert.match(context, /is starting in the background/);
    assert.doesNotMatch(context, /already finished/);
    assert.ok(await eventually(() => existsSync(s.launched)), "bringup was not relaunched");
    assert.equal(readFileSync(path.join(s.lock, "boot_id"), "utf8").trim(), "boot-B");
  });
}

test("a lock and sentinel from THIS boot keep the 'already finished' message", async (t) => {
  const s = scratch(t);
  priorLock(s, { boot: "boot-B" });
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /already finished this session/);
  assert.doesNotMatch(context, /restarted/);
  assert.equal(await eventually(() => existsSync(s.launched), 300), false, "bringup must not relaunch");
});

test("a lock written before boot ids were recorded keeps the old behavior", async (t) => {
  const s = scratch(t);
  priorLock(s, { boot: undefined });
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /already finished this session/);
  assert.equal(await eventually(() => existsSync(s.launched), 300), false);
});

test("a host with no boot id keeps the old behavior", async (t) => {
  const s = scratch(t);
  priorLock(s, { boot: "boot-A" });
  const context = runHook(s, { boot: null });
  assert.match(context, /already finished this session/);
  assert.equal(await eventually(() => existsSync(s.launched), 300), false);
});

test("a fresh launch records the boot it ran in", async (t) => {
  const s = scratch(t);
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /is starting in the background/);
  assert.doesNotMatch(context, /restarted/);
  assert.ok(await eventually(() => existsSync(s.launched)));
  assert.equal(readFileSync(path.join(s.lock, "boot_id"), "utf8").trim(), "boot-B");
});

test("the starting message tells a (dependencies) session to build the packages too", (t) => {
  const s = scratch(t);
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /run 'npm ci' yourself, then build the workspace packages/);
});
