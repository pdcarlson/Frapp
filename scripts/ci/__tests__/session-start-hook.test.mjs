import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Drives the REAL .claude/hooks/session-start.sh, not a copy of its logic: each case builds a
// scratch git repo, a scratch bringup lock and log, a fake boot id and a fake /proc/stat,
// points the hook at them through the variables it reads, and checks what it did. A stub
// `cloud-sandbox-up.sh` stands in for bringup and only records that it was launched; the real
// `scripts/setup-git-hooks.mjs` is copied in, because the hook runs it.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HOOK = path.join(REPO_ROOT, ".claude/hooks/session-start.sh");
const INSTALLER = path.join(REPO_ROOT, "scripts/setup-git-hooks.mjs");

// Every git call sees only the scratch repo's own config. A developer's global hooksPath (a
// common home for gitleaks or Talisman hooks) would otherwise read through as the "unset"
// value these cases start from.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args) => spawnSync("git", args, { env: GIT_ENV, encoding: "utf8" });

function scratch(t, { prePush = true, bringup = true, installer = true, bringupBody = "" } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "session-start-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "repo");
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root], { env: GIT_ENV });
  mkdirSync(path.join(root, "scripts"));
  if (prePush) {
    mkdirSync(path.join(root, ".githooks"));
    for (const hook of ["pre-push", "pre-commit"]) {
      writeFileSync(path.join(root, ".githooks", hook), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    }
  }
  if (installer) copyFileSync(INSTALLER, path.join(root, "scripts", "setup-git-hooks.mjs"));
  const launched = path.join(dir, "launched");
  // Appends rather than touches, so a test can count how many bringups started.
  if (bringup) {
    writeFileSync(path.join(root, "scripts", "cloud-sandbox-up.sh"), `echo x >> ${JSON.stringify(launched)}\n${bringupBody}`);
  }
  return {
    dir,
    root,
    launched,
    lock: path.join(dir, "cloud-sandbox-up.lock"),
    log: path.join(dir, "cloud-sandbox-up.log"),
    bootFile: path.join(dir, "boot_id"),
    procStat: path.join(dir, "proc-stat"),
  };
}

/**
 * Run the hook. `boot` is the current boot id, or null for a host that exposes none;
 * `btime` is the kernel boot time, in epoch seconds, the fake /proc/stat reports.
 */
function hookEnv(s, { boot = "boot-B", btime = 1000, cloud = true } = {}) {
  if (boot !== null) writeFileSync(s.bootFile, `${boot}\n`);
  writeFileSync(s.procStat, `cpu  1 2 3 4\nbtime ${btime}\nprocesses 1\n`);
  const env = {
    ...GIT_ENV,
    CLAUDE_PROJECT_DIR: s.root,
    // Never the host's real marker: this machine may well carry one.
    FRAPP_CLOUD_MARKER: path.join(s.dir, "no-cloud-marker-here"),
    FRAPP_BRINGUP_LOCK: s.lock,
    FRAPP_BRINGUP_LOG: s.log,
    FRAPP_BOOT_ID_FILE: boot === null ? path.join(s.dir, "no-boot-id-here") : s.bootFile,
    FRAPP_PROC_STAT: s.procStat,
  };
  if (cloud) env.FRAPP_CLOUD_SANDBOX = "1";
  else delete env.FRAPP_CLOUD_SANDBOX;
  return env;
}

function runHook(s, options) {
  const run = spawnSync("bash", [HOOK], { env: hookEnv(s, options), encoding: "utf8" });
  assert.equal(run.status, 0, `hook exited ${run.status}: ${run.stderr}`);
  return run.stdout.trim() ? JSON.parse(run.stdout).hookSpecificOutput.additionalContext : "";
}

/** A lock left by an earlier bringup, as launch_bringup writes it (`boot` undefined: an old hook's lock). */
function priorLock(s, { boot, sentinel = ".cloud-sandbox-up.done", writtenAt } = {}) {
  mkdirSync(s.lock);
  writeFileSync(path.join(s.lock, "pid"), "999999\n");
  if (boot !== undefined) writeFileSync(path.join(s.lock, "boot_id"), `${boot}\n`);
  if (sentinel) writeFileSync(path.join(s.root, sentinel), "2026-09-23T01:46:36Z\n");
  if (writtenAt !== undefined) utimesSync(s.lock, writtenAt, writtenAt);
}

const hooksPath = (s) => git("-C", s.root, "config", "--get", "core.hooksPath").stdout.trim();

async function eventually(check, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

// ── The review gate (#2488) ─────────────────────────────────────────────────

test("a cloud session arms the review gate in a checkout that never ran npm ci", (t) => {
  const s = scratch(t, { bringup: false });
  assert.equal(hooksPath(s), "", "precondition: a fresh clone has no hooksPath");
  runHook(s);
  assert.equal(hooksPath(s), ".githooks");
});

test("it runs the npm installer, so a hook that lost its exec bit is executable again", (t) => {
  const s = scratch(t, { bringup: false });
  const prePush = path.join(s.root, ".githooks", "pre-push");
  chmodSync(prePush, 0o644);
  runHook(s);
  assert.equal(hooksPath(s), ".githooks");
  assert.ok(statSync(prePush).mode & 0o100, "pre-push should be executable again");
});

test("without node's installer script it still sets the path with plain git", (t) => {
  const s = scratch(t, { bringup: false, installer: false });
  runHook(s);
  assert.equal(hooksPath(s), ".githooks");
});

test("a cloud session points a hooksPath naming another directory back at .githooks", (t) => {
  const s = scratch(t, { bringup: false });
  git("-C", s.root, "config", "core.hooksPath", "/somewhere/else");
  runHook(s);
  assert.equal(hooksPath(s), ".githooks");
});

test("a laptop session leaves the hooks path alone, unset or custom", (t) => {
  // SECRET_SCANNING.md's opt-out (`git config --unset core.hooksPath`) and a developer's own
  // hooks directory must survive session start; only `npm install` resets them on a laptop.
  const unset = scratch(t, { bringup: false });
  runHook(unset, { cloud: false });
  assert.equal(hooksPath(unset), "");

  const custom = scratch(t, { bringup: false });
  git("-C", custom.root, "config", "core.hooksPath", "/home/dev/.my-hooks");
  runHook(custom, { cloud: false });
  assert.equal(hooksPath(custom), "/home/dev/.my-hooks");
});

test("the cloud marker file alone makes it a cloud session", (t) => {
  const s = scratch(t, { bringup: false });
  const marker = path.join(s.dir, "frapp-cloud-sandbox");
  writeFileSync(marker, "");
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: s.root, FRAPP_CLOUD_MARKER: marker };
  delete env.FRAPP_CLOUD_SANDBOX;
  assert.equal(spawnSync("bash", [HOOK], { env }).status, 0);
  assert.equal(hooksPath(s), ".githooks");
});

test("sets nothing in a checkout with no committed pre-push hook", (t) => {
  const s = scratch(t, { prePush: false, bringup: false });
  runHook(s);
  assert.equal(hooksPath(s), "");
});

test("a (dependencies) sentinel no longer means an open gate", (t) => {
  const s = scratch(t);
  priorLock(s, { boot: "boot-B", sentinel: ".cloud-sandbox-up.failed" });
  runHook(s, { boot: "boot-B" });
  assert.equal(hooksPath(s), ".githooks");
});

test("the gate is armed before any bringup code runs", () => {
  // The behavioural cases above cannot see order: in their fixtures the bringup block always
  // completes. Order matters because a step added there that aborts under `set -e` would end
  // the hook before a later arming block ran. Pinned on the source instead.
  const hook = readFileSync(HOOK, "utf8");
  const arm = hook.indexOf("node scripts/setup-git-hooks.mjs");
  assert.ok(arm > 0, "arming block not found");
  for (const later of ["egress_summary() {", "launch_bringup() {", 'mkdir "$LOCK"']) {
    const at = hook.indexOf(later);
    assert.ok(at > arm, `${later} must come after the gate is armed`);
  }
});

// ── A lock from before a restart (#2515) ────────────────────────────────────

for (const sentinel of [".cloud-sandbox-up.done", ".cloud-sandbox-up.failed"]) {
  test(`a lock and ${sentinel} from an earlier boot relaunch bringup and say so`, async (t) => {
    const s = scratch(t);
    priorLock(s, { boot: "boot-A", sentinel });
    const context = runHook(s, { boot: "boot-B" });
    assert.match(context, /this machine restarted since the last bringup \(its lock carries another boot id\)/);
    assert.match(context, /is starting in the background/);
    assert.doesNotMatch(context, /already finished/);
    assert.ok(await eventually(() => existsSync(s.launched)), "bringup was not relaunched");
    assert.equal(readFileSync(path.join(s.lock, "boot_id"), "utf8").trim(), "boot-B");
    // Removed by the hook itself, so a second fire before bringup's own `rm -f` cannot
    // read the old sentinel next to the new lock.
    assert.equal(existsSync(path.join(s.root, sentinel)), false, `${sentinel} from the earlier boot is still there`);
  });
}

test("a second fire right after a restart relaunch does not report the old stack", (t) => {
  const s = scratch(t);
  priorLock(s, { boot: "boot-A" });
  runHook(s, { boot: "boot-B" });
  // The stub bringup writes no sentinel, as the real one has not yet at this point.
  const again = runHook(s, { boot: "boot-B" });
  assert.doesNotMatch(again, /already finished/);
});

test("a lock and sentinel from THIS boot keep the 'already finished' message", async (t) => {
  const s = scratch(t);
  priorLock(s, { boot: "boot-B" });
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /already finished this session/);
  assert.doesNotMatch(context, /restarted/);
  assert.ok(existsSync(path.join(s.root, ".cloud-sandbox-up.done")));
  assert.equal(await eventually(() => existsSync(s.launched), 300), false, "bringup must not relaunch");
});

test("an old hook's lock (no boot id) last written before this boot is stale", async (t) => {
  const s = scratch(t);
  priorLock(s, { boot: undefined, writtenAt: 1_700_000_000 });
  const context = runHook(s, { boot: "boot-B", btime: 1_700_000_500 });
  assert.match(context, /this machine restarted since the last bringup \(its lock predates this boot\)/);
  assert.ok(await eventually(() => existsSync(s.launched)), "bringup was not relaunched");
  assert.equal(readFileSync(path.join(s.lock, "boot_id"), "utf8").trim(), "boot-B");
});

/** A live process whose command line is `args`, killed when the test ends. */
function liveProcess(t, command, args) {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  t.after(() => {
    try {
      process.kill(child.pid);
    } catch {
      // already gone
    }
  });
  return child.pid;
}

/** A running bringup: bash executing a file named cloud-sandbox-up.sh. */
function liveBringup(t, s) {
  mkdirSync(path.join(s.dir, "inflight"));
  const script = path.join(s.dir, "inflight", "cloud-sandbox-up.sh");
  writeFileSync(script, "sleep 30\n");
  return liveProcess(t, "bash", [script]);
}

/** Point an existing lock at `pid`, keeping its mtime at `writtenAt`. */
function lockPid(s, pid, writtenAt) {
  writeFileSync(path.join(s.lock, "pid"), `${pid}\n`);
  if (writtenAt !== undefined) utimesSync(s.lock, writtenAt, writtenAt);
}

test("a lock whose bringup is still running is never torn down, whatever btime says", async (t) => {
  // A clock stepped forward (a sync, a resumed VM) raises btime past a same-boot lock's mtime.
  // The live bringup proves the lock is from this boot; relaunching would race it.
  const s = scratch(t);
  const pid = liveBringup(t, s);
  priorLock(s, { boot: undefined, sentinel: null });
  lockPid(s, pid, 1_700_000_000);
  const context = runHook(s, { boot: "boot-B", btime: 1_700_000_500 });
  assert.match(context, /stack bringup is still running \(pid \d+\)/);
  assert.doesNotMatch(context, /restarted/);
  assert.equal(readFileSync(path.join(s.lock, "pid"), "utf8").trim(), String(pid));
  assert.equal(await eventually(() => existsSync(s.launched), 300), false, "a second bringup must not start");
});

test("an empty boot id file is no evidence: a live bringup behind it is left alone", async (t) => {
  // What a concurrent fire would read between the file's creation and its write, or after a
  // failed write. Treated as a mismatch, it tore down a bringup that was running.
  const s = scratch(t);
  const pid = liveBringup(t, s);
  priorLock(s, { boot: "", sentinel: null });
  lockPid(s, pid, 1_700_000_000);
  const context = runHook(s, { boot: "boot-B", btime: 1_700_000_500 });
  assert.match(context, /stack bringup is still running/);
  assert.doesNotMatch(context, /restarted/);
  assert.equal(await eventually(() => existsSync(s.launched), 300), false, "a second bringup must not start");
});

test("a lock seconds old with no pid yet is a bringup starting, not a stale lock", async (t) => {
  // Between launch_bringup's mkdir and its pid write, a concurrent fire used to reclaim
  // the lock and start a second bringup racing the first.
  const s = scratch(t);
  mkdirSync(s.lock);
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /stack bringup is starting \(another session start took the lock \d+s ago\)/);
  assert.ok(existsSync(s.lock), "the lock must be left in place");
  assert.equal(await eventually(() => existsSync(s.launched), 300), false, "a second bringup must not start");
});

test("the same lock, minutes old with no live bringup, is reclaimed", async (t) => {
  const s = scratch(t);
  mkdirSync(s.lock);
  const old = Math.floor(Date.now() / 1000) - 600;
  utimesSync(s.lock, old, old);
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /cleared a stale bringup lock/);
  assert.ok(await eventually(() => existsSync(s.launched)), "bringup was not relaunched");
});

test("a lock dated in the future (a clock stepped back) is not 'starting'; it is reclaimed", async (t) => {
  const s = scratch(t);
  mkdirSync(s.lock);
  const ahead = Math.floor(Date.now() / 1000) + 3600;
  utimesSync(s.lock, ahead, ahead);
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /cleared a stale bringup lock/);
  assert.ok(await eventually(() => existsSync(s.launched)), "bringup was not relaunched");
});

test("two session starts at once on a stale lock start exactly one bringup", async (t) => {
  // Each read the lock, then acted on it; interleaved, both reclaimed and both relaunched.
  // The flock serializes the decision, so the second finds the first's fresh lock. The
  // window is milliseconds, so this is the outcome, not proof of the flock; the next test
  // pins that.
  const s = scratch(t);
  mkdirSync(s.lock);
  const old = Math.floor(Date.now() / 1000) - 600;
  utimesSync(s.lock, old, old);
  const env = hookEnv(s, { boot: "boot-B" });
  const fire = () =>
    new Promise((resolve) => {
      const child = spawn("bash", [HOOK], { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
    });
  const runs = await Promise.all([fire(), fire(), fire()]);
  assert.deepEqual(runs.map((r) => r.code), [0, 0, 0]);
  await eventually(() => existsSync(s.launched));
  // Let any second bringup that was going to start get there.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(readFileSync(s.launched, "utf8").trim().split("\n").length, 1, "exactly one bringup");
});

test("the lock decision waits for the guard another session start holds", async (t) => {
  // The concurrent-fire test above passes with or without the flock whenever the fires
  // happen not to interleave, which is most runs. This pins the flock itself: hold the
  // guard from outside and the hook must wait for it before deciding.
  const s = scratch(t);
  const holder = spawn("flock", [`${s.lock}.guard`, "sleep", "1.5"], { stdio: "ignore" });
  t.after(() => holder.kill());
  assert.ok(
    await eventually(() => spawnSync("flock", ["-n", `${s.lock}.guard`, "true"]).status !== 0, 3000),
    "precondition: the guard is held",
  );
  const started = Date.now();
  runHook(s, { boot: "boot-B" });
  assert.ok(Date.now() - started >= 1000, `the hook decided without waiting (${Date.now() - started}ms)`);
});

test("a running bringup does not hold the decision guard", async (t) => {
  // It would, had it inherited the descriptor: every later session start would then wait
  // out the flock timeout for as long as the stack took to come up.
  const s = scratch(t, { bringupBody: "sleep 5\n" });
  runHook(s, { boot: "boot-B" });
  assert.ok(await eventually(() => existsSync(s.launched)), "bringup did not start");
  const probe = spawnSync("flock", ["-n", `${s.lock}.guard`, "true"]);
  assert.equal(probe.status, 0, "the guard is still held after the hook returned");
});

test("the boot id test never consults the pid: after a restart it may name another process", async (t) => {
  const s = scratch(t);
  const pid = liveBringup(t, s);
  priorLock(s, { boot: "boot-A" });
  lockPid(s, pid);
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /its lock carries another boot id/);
  assert.ok(await eventually(() => existsSync(s.launched)), "bringup was not relaunched");
});

test("a process that only names the log is not a live bringup", async (t) => {
  // Lock, no sentinel, and the recorded pid now held by something like
  // `tail -f /tmp/cloud-sandbox-up.log`: the lock is stale, so it is reclaimed.
  const s = scratch(t);
  const pid = liveProcess(t, process.execPath, ["-e", "setTimeout(() => {}, 30000)", "/tmp/cloud-sandbox-up.log"]);
  priorLock(s, { boot: "boot-B", sentinel: null });
  lockPid(s, pid, Math.floor(Date.now() / 1000) - 3600);
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /cleared a stale bringup lock/);
  assert.ok(await eventually(() => existsSync(s.launched)), "bringup was not relaunched");
});

test("an old hook's lock written during this boot keeps the old behavior", async (t) => {
  const s = scratch(t);
  priorLock(s, { boot: undefined, writtenAt: 1_700_000_900 });
  const context = runHook(s, { boot: "boot-B", btime: 1_700_000_500 });
  assert.match(context, /already finished this session/);
  assert.equal(await eventually(() => existsSync(s.launched), 300), false);
});

test("a host with no boot id keeps the old behavior", async (t) => {
  const s = scratch(t);
  priorLock(s, { boot: "boot-A", writtenAt: 1_700_000_000 });
  const context = runHook(s, { boot: null, btime: 1_700_000_500 });
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
  assert.equal(existsSync(path.join(s.lock, "boot_id.tmp")), false, "the boot id is renamed into place");
});

test("the starting message tells a (dependencies) session to build the packages, quoted for zsh", (t) => {
  const s = scratch(t);
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /run 'npm ci' yourself, then build the workspace packages/);
  assert.ok(context.includes(`--filter="./packages/*"`), "the filter must be quoted");
});
