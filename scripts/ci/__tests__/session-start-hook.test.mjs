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
const LOCK_LIB = path.join(REPO_ROOT, "scripts/lib/bringup-lock.sh");
const BRINGUP = path.join(REPO_ROOT, "scripts/cloud-sandbox-up.sh");

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
  mkdirSync(path.join(root, "scripts", "lib"));
  copyFileSync(LOCK_LIB, path.join(root, "scripts", "lib", "bringup-lock.sh"));
  const launched = path.join(dir, "launched");
  // Appends rather than touches, so a test can count how many bringups started.
  if (bringup) {
    writeFileSync(
      path.join(root, "scripts", "cloud-sandbox-up.sh"),
      `echo "held=\${FRAPP_BRINGUP_LOCK_HELD:-no}" >> ${JSON.stringify(launched)}\n${bringupBody}`,
    );
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
  assert.match(context, /stack bringup is starting \(its lock was taken \d+s ago\)/);
  assert.ok(existsSync(s.lock), "the lock must be left in place");
  assert.equal(await eventually(() => existsSync(s.launched), 300), false, "a second bringup must not start");
});

test("a lock seconds old whose recorded bringup is dead is reclaimed at once", async (t) => {
  // It finished or was stopped; the young-lock grace covers only a pid not yet written or exec'd.
  const s = scratch(t);
  priorLock(s, { boot: "boot-B", sentinel: null });
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /cleared a stale bringup lock/);
  assert.ok(await eventually(() => existsSync(s.launched)), "bringup was not relaunched");
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
  // pins that. The stand-in bringup stays up, as a real one does for a minute or more: one
  // that exits at once with no sentinel is a dead bringup, and the next fire rightly reclaims it.
  const s = scratch(t, { bringupBody: "sleep 3\n" });
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

// ── A bringup run by hand (#2547) ───────────────────────────────────────────
//
// Only the hook used to take the lock, so `bash scripts/cloud-sandbox-up.sh` ran with none and a
// session start during it launched a second bringup. Both now go through scripts/lib/bringup-lock.sh.

/** Run bringup_take_lock from the real library; returns its exit status and output. */
function takeLock(lock, boot, pid) {
  const run = spawnSync("bash", ["-c", `. ${JSON.stringify(LOCK_LIB)}; bringup_take_lock "$1" "$2" "$3"`, "_", lock, boot, String(pid)], {
    encoding: "utf8",
  });
  return { status: run.status, out: run.stdout.trim() };
}

test("the hook tells the bringup it launched that the lock is already held", async (t) => {
  const s = scratch(t);
  runHook(s, { boot: "boot-B" });
  assert.ok(await eventually(() => existsSync(s.launched)));
  assert.equal(readFileSync(s.launched, "utf8").trim(), "held=1");
});

test("a hand run takes a free lock, recording its pid and boot", (t) => {
  const s = scratch(t);
  const { status } = takeLock(s.lock, "boot-B", 4242);
  assert.equal(status, 0);
  assert.equal(readFileSync(path.join(s.lock, "pid"), "utf8").trim(), "4242");
  assert.equal(readFileSync(path.join(s.lock, "boot_id"), "utf8").trim(), "boot-B");
});

test("a hand run refuses while another bringup from this boot is running, and touches nothing", (t) => {
  const s = scratch(t);
  const pid = liveBringup(t, s);
  priorLock(s, { boot: "boot-B", sentinel: null });
  lockPid(s, pid);
  const { status, out } = takeLock(s.lock, "boot-B", 4242);
  assert.equal(status, 1);
  assert.equal(out, String(pid), "it names the running bringup");
  assert.equal(readFileSync(path.join(s.lock, "pid"), "utf8").trim(), String(pid));
});

test("a hand run judges a young lock by the hook's rule: starting, not dead", (t) => {
  // The hook's taker writes the pid only after launching bringup; a hand run that reclaimed
  // the lock in that window would start a second bringup racing the first.
  const s = scratch(t);
  mkdirSync(s.lock);
  const { status, out } = takeLock(s.lock, "boot-B", 4242);
  assert.equal(status, 1);
  assert.equal(out, "starting");
  assert.equal(existsSync(path.join(s.lock, "pid")), false, "the young lock is left as it was");
});

test("a hand run judges a young lock with a dead pid as finished, and replaces it at once", (t) => {
  // A bringup that exited or was stopped seconds ago is not one starting: refusing it sent a
  // re-run to wait out the grace for a sentinel that may never come.
  const s = scratch(t);
  priorLock(s, { boot: "boot-B", sentinel: null });
  assert.equal(takeLock(s.lock, "boot-B", 4242).status, 0);
  assert.equal(readFileSync(path.join(s.lock, "pid"), "utf8").trim(), "4242");
});

test("a young lock whose pid is live but not yet a bringup is starting, for both writers", async (t) => {
  // The taker records `$!` at once, and for a moment that pid is still a fork of the taker.
  const s = scratch(t);
  const pid = liveProcess(t, "sleep", ["30"]);
  priorLock(s, { boot: "boot-B", sentinel: null });
  lockPid(s, pid);
  assert.deepEqual(takeLock(s.lock, "boot-B", 4242), { status: 1, out: "starting" });
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, /stack bringup is starting/);
  assert.equal(await eventually(() => existsSync(s.launched), 300), false, "a second bringup must not start");
});

test("a hand run replaces a stray file at the lock path, as the hook does", (t) => {
  const s = scratch(t);
  writeFileSync(s.lock, "not a directory\n");
  utimesSync(s.lock, 1_700_000_000, 1_700_000_000);
  assert.equal(takeLock(s.lock, "boot-B", 4242).status, 0);
  assert.equal(readFileSync(path.join(s.lock, "pid"), "utf8").trim(), "4242");
});

test("a hand run reports a lock it cannot create apart from a running bringup", (t) => {
  const s = scratch(t);
  const { status, out } = takeLock(path.join(s.dir, "no-such-dir", "cloud-sandbox-up.lock"), "boot-B", 4242);
  assert.equal(status, 2);
  assert.equal(out, "");
});

test("a hand run replaces a lock whose bringup is dead, or that another boot left", (t) => {
  const old = Math.floor(Date.now() / 1000) - 600;
  const dead = scratch(t);
  priorLock(dead, { boot: "boot-B", sentinel: null, writtenAt: old });
  assert.equal(takeLock(dead.lock, "boot-B", 4242).status, 0);
  assert.equal(readFileSync(path.join(dead.lock, "pid"), "utf8").trim(), "4242");

  // After a restart the old pid may name a live process again; the boot id says it is not ours.
  const other = scratch(t);
  const pid = liveBringup(t, other);
  priorLock(other, { boot: "boot-A", sentinel: null });
  lockPid(other, pid);
  assert.equal(takeLock(other.lock, "boot-B", 4242).status, 0);
  assert.equal(readFileSync(path.join(other.lock, "boot_id"), "utf8").trim(), "boot-B");
});

test("the real cloud-sandbox-up.sh, run by hand while a bringup runs, refuses and says why", (t) => {
  // Run from a scratch copy of the repo's scripts, so nothing it could reach is the real
  // checkout. The refusal comes before the sentinels are cleared and before any Docker step.
  const s = scratch(t, { bringup: false });
  const script = realBringup(s);
  writeFileSync(path.join(s.root, ".cloud-sandbox-up.done"), "the running bringup's\n");
  const pid = liveBringup(t, s);
  priorLock(s, { boot: "boot-B", sentinel: null });
  lockPid(s, pid);
  writeFileSync(s.bootFile, "boot-B\n");
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: s.root, FRAPP_BRINGUP_LOG: s.log, FRAPP_BRINGUP_LOCK: s.lock, FRAPP_BOOT_ID_FILE: s.bootFile };
  delete env.FRAPP_BRINGUP_LOCK_HELD;
  const run = spawnSync("bash", [script], {
    env,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(run.status, 1, `expected a refusal, got ${run.status}: ${run.stderr}`);
  // On stderr, where cs_log writes: an `exec 9>&- 2>/dev/null` once sent it, and every later
  // line of the bringup log, to /dev/null.
  assert.match(run.stderr, new RegExp(`another bringup is already running \\(pid ${pid}\\)`));
  // A hung bringup is alive too: the refusal names the way past it.
  assert.match(run.stderr, /stop it with 'bash scripts\/cloud-sandbox-up\.sh --stop' and run this again/);
  assert.equal(readFileSync(path.join(s.root, ".cloud-sandbox-up.done"), "utf8"), "the running bringup's\n");
  assert.equal(readFileSync(path.join(s.lock, "pid"), "utf8").trim(), String(pid));
});

test("the real cloud-sandbox-up.sh says when it cannot take the lock at all, not that one is running", (t) => {
  const s = scratch(t, { bringup: false });
  const script = realBringup(s);
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: s.root, FRAPP_BRINGUP_LOG: s.log, FRAPP_BRINGUP_LOCK: path.join(s.dir, "no-such-dir", "lock") };
  delete env.FRAPP_BRINGUP_LOCK_HELD;
  const run = spawnSync("bash", [script], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(run.status, 1, `expected a refusal, got ${run.status}: ${run.stderr}`);
  assert.match(run.stderr, /could not take the bringup lock/);
  assert.doesNotMatch(run.stderr, /already running/);
});

test("cloud-sandbox-up.sh takes the lock itself unless the hook holds it, before clearing sentinels", () => {
  const up = readFileSync(BRINGUP, "utf8");
  const commands = up.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  const take = commands.indexOf('bringup_take_lock "$BRINGUP_LOCK"');
  const clear = commands.indexOf('rm -f "$DONE_SENTINEL" "$FAILED_SENTINEL" "$EGRESS_MANIFEST"');
  assert.ok(take > 0, "a hand run must take the lock");
  assert.ok(clear > take, "a refused run must not erase the running bringup's sentinels");
  const gate = commands.lastIndexOf('if [ -z "${FRAPP_BRINGUP_LOCK_HELD:-}" ]; then', take);
  assert.ok(gate > 0 && gate < take, "the take is skipped when the hook already holds the lock");
  assert.match(commands.slice(gate, take), /bringup_guard "\$BRINGUP_LOCK"/, "it takes the lock under the hook's guard");
  const lib = readFileSync(LOCK_LIB, "utf8");
  const guardFn = lib.slice(lib.indexOf("bringup_guard() {"), lib.indexOf("\n}", lib.indexOf("bringup_guard() {")));
  assert.match(guardFn, /exec 9>>"\$1\.guard"/);
  assert.match(guardFn, /flock -w 10 9/);
  // The hook decides under the same helper, so the two cannot drift onto different guards.
  const hook = readFileSync(HOOK, "utf8");
  assert.match(hook, /^\s*bringup_guard "\$LOCK"$/m);
  assert.match(hook, /^\s*bringup_unguard$/m);
  assert.doesNotMatch(hook, /flock -w/, "the hook takes the guard only through the lib");
  assert.match(commands.slice(take, clear), /exit 1/, "a refused run stops");
  // Once taken: the old sentinels go while the guard is still held, then the guard is
  // released, then the run's output goes to the log session starts point at.
  const taken = commands.indexOf("    0)", take);
  const clearHeld = commands.indexOf('rm -f "$DONE_SENTINEL" "$FAILED_SENTINEL"', taken);
  const release = commands.indexOf("bringup_unguard", taken);
  const tee = commands.indexOf('exec > >(tee "$BRINGUP_LOG") 2>&1', taken);
  assert.ok(taken > take && clearHeld > taken && clearHeld < release, "sentinels are cleared under the guard");
  assert.ok(tee > release && tee < clear, "a hand run writes the bringup log");
});

// ── A hung bringup: --stop ──────────────────────────────────────────────────
// `kill <pid>` ended only the script and orphaned the command it was blocked in, so the next
// bringup started beside that command. --stop ends the whole tree but the Docker daemon.

/** A bringup blocked in a foreground step, with a `dockerd` stand-in started in the background. */
function hungBringup(t, s) {
  const bin = path.join(s.dir, "hung");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "dockerd"), "sleep 60\n");
  const script = path.join(bin, "cloud-sandbox-up.sh");
  writeFileSync(script, `bash ${JSON.stringify(path.join(bin, "dockerd"))} &\nsleep 30\n`);
  const child = spawn("bash", [script], { detached: true, stdio: "ignore" });
  t.after(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  });
  return child.pid;
}

const childrenOf = (pid) =>
  spawnSync("ps", ["-o", "pid=,args=", "--ppid", String(pid)], { encoding: "utf8" })
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ pid: Number(line.split(/\s+/)[0]), args: line.replace(/^\d+\s+/, "") }));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A scratch copy of the real cloud-sandbox-up.sh and the libraries it sources. Every run of it
 * sets FRAPP_BRINGUP_LOG: a regression that let it past the lock would otherwise overwrite the
 * machine's real bringup log.
 */
function realBringup(s) {
  for (const lib of ["cloud-sandbox-common.sh", "local-postgres-acl.sh", "local-seed-data.sh"]) {
    copyFileSync(path.join(REPO_ROOT, "scripts", "lib", lib), path.join(s.root, "scripts", "lib", lib));
  }
  copyFileSync(BRINGUP, path.join(s.root, "scripts", "cloud-sandbox-up.sh"));
  return path.join(s.root, "scripts", "cloud-sandbox-up.sh");
}

/** Run bringup_stop from the real library, as the caller's own pid, in boot `boot`. */
function stopLock(lock, boot) {
  return spawnSync("bash", ["-c", `. ${JSON.stringify(LOCK_LIB)}; bringup_stop "$1" "$$" "$2"`, "_", lock, boot], {
    encoding: "utf8",
    timeout: 30000,
  });
}

test("bringup_stop ends a hung bringup and everything under it, but not the Docker daemon", async (t) => {
  const s = scratch(t);
  const pid = hungBringup(t, s);
  assert.ok(await eventually(() => childrenOf(pid).length === 2), "the stand-in bringup did not start its children");
  const kids = childrenOf(pid);
  const daemon = kids.find((k) => /dockerd/.test(k.args)).pid;
  const hung = kids.find((k) => /^sleep 30/.test(k.args)).pid;
  const daemonChild = await (async () => {
    await eventually(() => childrenOf(daemon).length === 1);
    return childrenOf(daemon)[0]?.pid;
  })();
  priorLock(s, { boot: "boot-B", sentinel: null });
  lockPid(s, pid);
  const run = stopLock(s.lock, "boot-B");
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), String(pid), "it names what it stopped");
  assert.ok(await eventually(() => !alive(pid) && !alive(hung)), "the script and its blocked step must both be gone");
  assert.ok(alive(daemon) && alive(daemonChild), "the Docker daemon and what runs under it are left running");
  assert.equal(existsSync(s.lock), false, "the lock goes with the bringup");
});

test("cloud-sandbox-up.sh --stop stops a hung bringup, and says so when none was running", async (t) => {
  const s = scratch(t, { bringup: false });
  const script = realBringup(s);
  const pid = hungBringup(t, s);
  assert.ok(await eventually(() => childrenOf(pid).length === 2));
  priorLock(s, { boot: "boot-B", sentinel: null });
  lockPid(s, pid);
  writeFileSync(s.bootFile, "boot-B\n");
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: s.root, FRAPP_BRINGUP_LOG: s.log, FRAPP_BRINGUP_LOCK: s.lock, FRAPP_BOOT_ID_FILE: s.bootFile };
  delete env.FRAPP_BRINGUP_LOCK_HELD;
  const stop = spawnSync("bash", [script, "--stop"], { env, encoding: "utf8", timeout: 20000 });
  assert.equal(stop.status, 0, stop.stderr);
  assert.match(stop.stderr, new RegExp(`Stopped bringup pid ${pid}`));
  assert.ok(await eventually(() => !alive(pid)));
  assert.equal(existsSync(s.lock), false);

  const again = spawnSync("bash", [script, "--stop"], { env, encoding: "utf8", timeout: 20000 });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stderr, /No bringup was running/);
});

test("--stop leaves a starting bringup's lock alone", (t) => {
  // Removing it would let a second bringup start beside the one about to exec.
  const s = scratch(t, { bringup: false });
  const script = realBringup(s);
  mkdirSync(s.lock);
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: s.root, FRAPP_BRINGUP_LOG: s.log, FRAPP_BRINGUP_LOCK: s.lock };
  delete env.FRAPP_BRINGUP_LOCK_HELD;
  const stop = spawnSync("bash", [script, "--stop"], { env, encoding: "utf8", timeout: 20000 });
  assert.equal(stop.status, 1);
  assert.match(stop.stderr, /a bringup is starting/);
  assert.ok(existsSync(s.lock));
});

test("a command line that only mentions the script is not a bringup, so --stop never kills it", async (t) => {
  // bringup_alive decides what bringup_stop signals: an agent's `bash -c` wrapper or an editor
  // holding scripts/cloud-sandbox-up.sh is not a bringup, whatever its args contain.
  const s = scratch(t);
  for (const [command, args] of [
    // Two commands, so bash stays the process rather than exec'ing `sleep`.
    ["bash", ["-c", "sleep 30; true", "cloud-sandbox-up.sh"]],
    ["node", ["-e", "setTimeout(() => {}, 30000)", "scripts/cloud-sandbox-up.sh"]],
  ]) {
    const pid = liveProcess(t, command, args);
    assert.ok(
      await eventually(() => /cloud-sandbox-up\.sh/.test(spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" }).stdout)),
      `precondition: ${command}'s command line names the script`,
    );
    rmSync(s.lock, { recursive: true, force: true });
    priorLock(s, { boot: "boot-B", sentinel: null, writtenAt: Math.floor(Date.now() / 1000) - 600 });
    lockPid(s, pid, Math.floor(Date.now() / 1000) - 600);
    const run = stopLock(s.lock, "boot-B");
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "", `${command} is not reported as a stopped bringup`);
    assert.ok(alive(pid), `${command} must not be signalled`);
    assert.equal(existsSync(s.lock), false, "its dead lock is still removed");
  }
});

test("bringup_stop kills nothing for a lock another boot left, whatever its pid now names", async (t) => {
  const s = scratch(t);
  const pid = liveBringup(t, s);
  priorLock(s, { boot: "boot-A", sentinel: null });
  lockPid(s, pid);
  const run = stopLock(s.lock, "boot-B");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "");
  assert.ok(alive(pid), "a pid recorded in another boot may belong to anything by now");
  assert.equal(existsSync(s.lock), false);
});

test("while --stop waits for a stubborn tree, the lock names it, so no second bringup starts", async (t) => {
  // It lets go of the guard while the old tree dies. Holding it for ten seconds or more let a
  // session start's `flock -w 10` time out and launch beside the dying tree, and a final
  // unconditional `rm -rf` then deleted that new bringup's lock.
  const s = scratch(t, { bringup: false });
  const script = realBringup(s);
  const bin = path.join(s.dir, "stubborn");
  mkdirSync(bin);
  const hung = path.join(bin, "cloud-sandbox-up.sh");
  writeFileSync(hung, `bash -c 'trap "" TERM; while :; do sleep 1; done'\n`);
  const child = spawn("bash", [hung], { detached: true, stdio: "ignore" });
  t.after(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  });
  assert.ok(await eventually(() => childrenOf(child.pid).length === 1));
  const blocked = childrenOf(child.pid)[0].pid;
  priorLock(s, { boot: "boot-B", sentinel: null });
  lockPid(s, child.pid);
  writeFileSync(s.bootFile, "boot-B\n");
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: s.root, FRAPP_BRINGUP_LOG: s.log, FRAPP_BRINGUP_LOCK: s.lock, FRAPP_BOOT_ID_FILE: s.bootFile };
  delete env.FRAPP_BRINGUP_LOCK_HELD;
  const stopper = spawn("bash", [script, "--stop"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  stopper.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((resolve) => stopper.on("close", resolve));
  const stoppingFile = path.join(s.lock, "stopping");
  assert.ok(
    await eventually(() => existsSync(stoppingFile) && readFileSync(stoppingFile, "utf8").trim() === String(stopper.pid)),
    "the stopper marks the lock",
  );
  // A hand run, a session start and a second --stop all find a stop in progress.
  assert.deepEqual(takeLock(s.lock, "boot-B", 4242), { status: 1, out: `stopping:${stopper.pid}` });
  const context = runHook(s, { boot: "boot-B" });
  assert.match(context, new RegExp(`a hung stack bringup is being stopped \\(cloud-sandbox-up\\.sh --stop, pid ${stopper.pid}\\)`));
  assert.equal(existsSync(s.launched), false);
  const second = spawnSync("bash", [script, "--stop"], { env, encoding: "utf8", timeout: 20000 });
  assert.equal(second.status, 1);
  assert.match(second.stderr, new RegExp(`another --stop \\(pid ${stopper.pid}\\) is already stopping`));
  assert.ok(alive(stopper.pid), "the second --stop leaves the first alone");
  assert.equal(await exited, 0, stderr);
  assert.match(stderr, new RegExp(`Stopped bringup pid ${child.pid}`));
  assert.ok(await eventually(() => !alive(blocked)), "the TERM-proof step is killed");
  assert.equal(existsSync(s.lock), false);
  // What a session told to wait is watching for.
  assert.match(readFileSync(path.join(s.root, ".cloud-sandbox-up.failed"), "utf8"), new RegExp(`cloud-sandbox-up\\.sh --stop stopped bringup pid ${child.pid}\\.`));
});

test("--stop says it could not remove a lock rather than claiming it did", { skip: process.getuid?.() === 0 && "root ignores directory permissions" }, (t) => {
  const s = scratch(t, { bringup: false });
  const script = realBringup(s);
  const parent = path.join(s.dir, "locked");
  mkdirSync(parent);
  const lock = path.join(parent, "cloud-sandbox-up.lock");
  mkdirSync(lock);
  const old = Math.floor(Date.now() / 1000) - 600;
  utimesSync(lock, old, old);
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: s.root, FRAPP_BRINGUP_LOG: s.log, FRAPP_BRINGUP_LOCK: lock };
  delete env.FRAPP_BRINGUP_LOCK_HELD;
  chmodSync(parent, 0o555);
  let stop;
  try {
    stop = spawnSync("bash", [script, "--stop"], { env, encoding: "utf8", timeout: 20000 });
  } finally {
    // Before the scratch cleanup, which cannot remove the lock otherwise.
    chmodSync(parent, 0o755);
  }
  assert.equal(stop.status, 1);
  assert.match(stop.stderr, /could not write or remove the bringup lock/);
  assert.doesNotMatch(stop.stderr, /removed any lock/);
  assert.ok(existsSync(lock));
});

test("--stop that kills a bringup but cannot remove its lock says so", { skip: process.getuid?.() === 0 && "root ignores directory permissions" }, async (t) => {
  // `rm -rf` empties the lock yet cannot unlink it from a directory it may not write.
  const s = scratch(t, { bringup: false });
  const script = realBringup(s);
  const parent = path.join(s.dir, "locked");
  mkdirSync(parent);
  const lock = path.join(parent, "cloud-sandbox-up.lock");
  mkdirSync(lock);
  const pid = liveBringup(t, s);
  writeFileSync(path.join(lock, "pid"), `${pid}\n`);
  writeFileSync(s.bootFile, "boot-B\n");
  writeFileSync(path.join(lock, "boot_id"), "boot-B\n");
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: s.root, FRAPP_BRINGUP_LOG: s.log, FRAPP_BRINGUP_LOCK: lock, FRAPP_BOOT_ID_FILE: s.bootFile };
  delete env.FRAPP_BRINGUP_LOCK_HELD;
  chmodSync(parent, 0o555);
  let stop;
  try {
    stop = spawnSync("bash", [script, "--stop"], { env, encoding: "utf8", timeout: 30000 });
  } finally {
    chmodSync(parent, 0o755);
  }
  assert.equal(stop.status, 1, stop.stderr);
  assert.match(stop.stderr, new RegExp(`stopped bringup pid ${pid} and the commands under it, but could not remove the lock`));
  assert.ok(await eventually(() => !alive(pid)));
});

test("a bringup at a path with a space, or run with a long option, is still a bringup", async (t) => {
  // `ps` prints argv joined by spaces; a regex over that rejected both.
  const s = scratch(t);
  const dir = path.join(s.dir, "with space");
  mkdirSync(dir);
  const script = path.join(dir, "cloud-sandbox-up.sh");
  writeFileSync(script, "sleep 30\n");
  for (const args of [[script], ["--norc", script]]) {
    const pid = liveProcess(t, "bash", args);
    const run = spawnSync("bash", ["-c", `. ${JSON.stringify(LOCK_LIB)}; bringup_alive "$1"`, "_", String(pid)]);
    assert.equal(run.status, 0, `bash ${args.join(" ")} is alive`);
  }
});

test("processes that outlive SIGKILL keep the lock live until --stop is retried", async (t) => {
  // Faked by making `kill` and `sleep` no-ops, so the tree survives every signal at once.
  const s = scratch(t);
  const pid = liveBringup(t, s);
  priorLock(s, { boot: "boot-B", sentinel: null });
  lockPid(s, pid);
  const failed = path.join(s.root, ".cloud-sandbox-up.failed");
  const run = spawnSync(
    "bash",
    ["-c", `. ${JSON.stringify(LOCK_LIB)}; kill() { :; }; sleep() { :; }; bringup_stop "$1" "$$" boot-B "$2"`, "_", s.lock, failed],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(run.status, 3, run.stderr);
  assert.match(run.stdout, new RegExp(`^${pid}\nsurvivors: .*\\b${pid}\\b`));
  assert.equal(existsSync(path.join(s.lock, "stopping")), false, "no longer marked as being stopped");
  assert.match(readFileSync(path.join(s.lock, "survivors"), "utf8"), new RegExp(`^${pid} \\S`, "m"));
  assert.match(readFileSync(failed, "utf8"), new RegExp(`stopped bringup pid ${pid}, but processes .* outlived SIGKILL\\. The lock is kept`));
  // The lock stays live with its script dead: a hand run refuses, and the hook launches nothing
  // even with the .failed gone.
  const script = liveProcess(t, "sleep", ["30"]);
  lockPid(s, script, Math.floor(Date.now() / 1000) - 600);
  process.kill(script);
  // The stand-in's own `sleep` survived with it.
  const refused = takeLock(s.lock, "boot-B", 4242);
  assert.equal(refused.status, 1);
  assert.match(refused.out, new RegExp(`^survivors:.*\\b${pid}\\b`));
  const stuck = refused.out.slice("survivors:".length).split(" ").map(Number);
  rmSync(failed);
  assert.match(runHook(s, { boot: "boot-B" }), /processes a stopped bringup left behind are still running/);
  assert.equal(await eventually(() => existsSync(s.launched), 300), false, "nothing launches beside the survivors");
  // --stop again, with real signals, retries them and frees the lock.
  const retry = spawnSync(
    "bash",
    ["-c", `. ${JSON.stringify(LOCK_LIB)}; bringup_stop "$1" "$$" boot-B "$2"`, "_", s.lock, failed],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.stdout.trim(), `retried:${stuck.join(" ")}`, "it names what it retried, not the dead script");
  assert.match(
    readFileSync(failed, "utf8"),
    new RegExp(`stopped the processes ${stuck.join(" ")} an earlier --stop left behind\\.`),
    "and so does the sentinel",
  );
  assert.ok(await eventually(() => stuck.every((p) => !alive(p))), "every survivor is stopped on retry");
  assert.equal(existsSync(s.lock), false);
});

test("a survivor's pid, reused by another process, is never signalled", (t) => {
  // The survivors file records start times; a pid that exited and came back as something
  // else no longer matches, and must not keep the lock live or be killed.
  const s = scratch(t);
  const other = liveProcess(t, "sleep", ["30"]);
  priorLock(s, { boot: "boot-B", sentinel: null, writtenAt: Math.floor(Date.now() / 1000) - 600 });
  writeFileSync(path.join(s.lock, "survivors"), `${other} 1\n`);
  utimesSync(s.lock, Math.floor(Date.now() / 1000) - 600, Math.floor(Date.now() / 1000) - 600);
  const run = stopLock(s.lock, "boot-B");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "");
  assert.ok(alive(other));
  assert.equal(existsSync(s.lock), false);
});

test("a fresh launch clears an older run's sentinel under the guard", async (t) => {
  // With no lock there is no bringup, so a .failed from a stopped run is stale; a second fire
  // before the new bringup cleared it would report it as the new run's.
  const s = scratch(t, { bringupBody: "sleep 3\n" });
  writeFileSync(path.join(s.root, ".cloud-sandbox-up.failed"), "stopped by --stop\n");
  runHook(s, { boot: "boot-B" });
  assert.equal(existsSync(path.join(s.root, ".cloud-sandbox-up.failed")), false);
  assert.match(runHook(s, { boot: "boot-B" }), /stack bringup is still running/);
});

test("a survivor's recorded start time does not depend on the clock's rendering or TZ", (t) => {
  // `ps -o lstart` is local wall-clock time: a TZ change or a clock step moved it, and a real
  // survivor then read as a reused pid, freeing the lock beside it.
  const pid = liveProcess(t, "sleep", ["30"]);
  const started = (tz) =>
    spawnSync("bash", ["-c", `. ${JSON.stringify(LOCK_LIB)}; bringup_started "$1"`, "_", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, TZ: tz },
    }).stdout.trim();
  assert.match(started("UTC"), /^\d+$/, "ticks since boot");
  assert.equal(started("UTC"), started("Asia/Tokyo"));
});

test("bringup_stop judges whether the lock went before it lets go of the guard", () => {
  // Checked after, a lock a waiting bringup took in the gap read as a removal failure; the
  // window is milliseconds, so the order is pinned rather than raced.
  const lib = readFileSync(LOCK_LIB, "utf8");
  const fn = lib.slice(lib.indexOf("bringup_stop() {"), lib.indexOf("\n}\n", lib.indexOf("bringup_stop() {")));
  // Every token must be found: a missing one reads as -1 and would pass any `<`.
  const at = (text, token) => {
    const i = text.indexOf(token);
    assert.ok(i >= 0, `bringup_stop no longer contains ${JSON.stringify(token)}`);
    return i;
  };
  const noTree = fn.slice(at(fn, 'if [ -z "$tree" ]; then'));
  assert.ok(at(noTree, '[ -e "$lock" ]') < at(noTree, "bringup_unguard"), "the no-bringup path checks first");
  const tail = fn.slice(fn.lastIndexOf('bringup_guard "$lock"'));
  assert.ok(at(tail, "leftover=1") < at(tail, "bringup_unguard"), "the stop path checks first");
});
