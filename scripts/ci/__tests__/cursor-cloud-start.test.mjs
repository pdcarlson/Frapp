import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Cursor-owned start contract: wait helper + environment.json terminals + the
// start scripts returning after sentinels (not starting npm). Placement follows
// cloud-sandbox-retry.test.mjs so `npm run test:ci-scripts` collects this file.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const waitScript = path.join(repoRoot, "scripts", "cursor-wait-sandbox.sh");
const startScript = path.join(repoRoot, "scripts", "cursor-agent-start.sh");
const upScript = path.join(repoRoot, "scripts", "cursor-cloud-up.sh");
const envJsonPath = path.join(repoRoot, ".cursor", "environment.json");

function parseEnvironmentJson(raw) {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

function wait(args, env, extra = {}) {
  return spawnSync("bash", [waitScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: extra.timeout ?? 8000,
  });
}

test("environment.json has no \$schema, no secrets, no guessed egress, and known keys only", () => {
  const raw = readFileSync(envJsonPath, "utf8");
  assert.doesNotMatch(raw, /"\$schema"/);
  const json = parseEnvironmentJson(raw);
  assert.deepEqual(
    Object.keys(json).sort(),
    ["install", "name", "ports", "start", "terminals", "user"].sort(),
  );
  assert.equal(json.install, "bash scripts/cursor-agent-install.sh");
  assert.equal(json.start, "bash scripts/cursor-agent-start.sh");
  assert.equal(json.user, "ubuntu");
  for (const key of Object.keys(json)) {
    assert.doesNotMatch(key, /secret|token|password|key$/i);
  }
  assert.equal(json.egressAllowlist, undefined);
  assert.equal(json.egressMode, undefined);
  const blob = JSON.stringify(json);
  assert.doesNotMatch(blob, /\b(sk_live|sk_test|ghp_|github_pat_)\b/);
});

test("terminals wait on existing sentinels then run through the Node 20 wrapper", () => {
  const json = parseEnvironmentJson(readFileSync(envJsonPath, "utf8"));
  const names = json.terminals.map((t) => t.name).sort();
  assert.deepEqual(names, ["api", "landing", "web"]);
  for (const terminal of json.terminals) {
    assert.match(terminal.command, /scripts\/cursor-wait-sandbox\.sh/);
    assert.doesNotMatch(
      terminal.command,
      /scripts\/cursor-node20\.sh/,
      "wait helper execs cursor-node20.sh; terminals should not double-wrap",
    );
  }
  assert.match(json.terminals[0].command, /npm run start:dev -w apps\/api/);
  const ports = json.ports.map((p) => p.port).sort((a, b) => a - b);
  assert.deepEqual(ports, [3000, 3001, 3002, 54321, 54323]);
});

test("start scripts return after bringup and do not start dev servers", () => {
  const start = readFileSync(startScript, "utf8");
  const up = readFileSync(upScript, "utf8");
  assert.match(start, /scripts\/cursor-cloud-up\.sh/);
  assert.match(up, /scripts\/cloud-sandbox-up\.sh/);
  assert.match(up, /\.cloud-sandbox-up\.done/);
  assert.match(up, /\.cloud-sandbox-up\.failed/);
  for (const [label, body] of [
    ["cursor-agent-start.sh", start],
    ["cursor-cloud-up.sh", up],
  ]) {
    assert.doesNotMatch(
      body,
      /npm run (start:dev|dev)/,
      `${label} must not start api/web/landing`,
    );
    assert.doesNotMatch(body, /session-start\.sh/);
    assert.doesNotMatch(
      body,
      /\[\s*-f\s+\/etc\/frapp-cloud-sandbox\s*\]/,
      `${label} must not treat the Claude sandbox marker as the reason it runs`,
    );
    assert.doesNotMatch(
      body,
      /^ROOT="\$\{CLAUDE_PROJECT_DIR/m,
      `${label} must not take CLAUDE_PROJECT_DIR as workspace root`,
    );
  }
  assert.match(up, /env -u CLAUDE_PROJECT_DIR/);
});

test("wait helper exits 0 when .cloud-sandbox-up.done already exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cursor-wait-done-"));
  try {
    writeFileSync(path.join(dir, ".cloud-sandbox-up.done"), "2026-09-09T00:00:00Z\n");
    const res = wait([], {
      CURSOR_WAIT_SANDBOX_ROOT: dir,
      CURSOR_WAIT_SANDBOX_INTERVAL: "0.05",
    });
    assert.equal(res.status, 0, res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wait helper accepts .cursor-cloud-up.done as a success alias", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cursor-wait-alias-"));
  try {
    writeFileSync(path.join(dir, ".cursor-cloud-up.done"), "ok\n");
    const res = wait([], {
      CURSOR_WAIT_SANDBOX_ROOT: dir,
      CURSOR_WAIT_SANDBOX_INTERVAL: "0.05",
    });
    assert.equal(res.status, 0, res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wait helper exits 1 and prints the body when .cloud-sandbox-up.failed exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cursor-wait-fail-"));
  try {
    writeFileSync(
      path.join(dir, ".cloud-sandbox-up.failed"),
      "supabase start failed (ratelimit)\n",
    );
    const res = wait([], {
      CURSOR_WAIT_SANDBOX_ROOT: dir,
      CURSOR_WAIT_SANDBOX_INTERVAL: "0.05",
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /stack bringup failed/);
    assert.match(res.stderr, /ratelimit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wait helper prefers .failed when both sentinels exist", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cursor-wait-both-"));
  try {
    writeFileSync(path.join(dir, ".cloud-sandbox-up.done"), "stale\n");
    writeFileSync(path.join(dir, ".cloud-sandbox-up.failed"), "policy\n");
    const res = wait([], {
      CURSOR_WAIT_SANDBOX_ROOT: dir,
      CURSOR_WAIT_SANDBOX_INTERVAL: "0.05",
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /policy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wait helper blocks until the success sentinel appears", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cursor-wait-later-"));
  try {
    const child = spawn("bash", [waitScript], {
      env: {
        ...process.env,
        CURSOR_WAIT_SANDBOX_ROOT: dir,
        CURSOR_WAIT_SANDBOX_INTERVAL: "0.05",
        CURSOR_WAIT_SANDBOX_TIMEOUT_SECONDS: "5",
      },
    });
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    await new Promise((r) => setTimeout(r, 120));
    writeFileSync(path.join(dir, ".cloud-sandbox-up.done"), "ready\n");
    assert.equal(await done, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wait helper times out instead of hanging when no sentinel arrives", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cursor-wait-timeout-"));
  try {
    const res = wait([], {
      CURSOR_WAIT_SANDBOX_ROOT: dir,
      CURSOR_WAIT_SANDBOX_INTERVAL: "0.05",
      CURSOR_WAIT_SANDBOX_TIMEOUT_SECONDS: "1",
    });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /timed out/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gitignore keeps historical sentinels and the Cursor alias", () => {
  const gi = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
  assert.match(gi, /^\.cloud-sandbox-up\.done$/m);
  assert.match(gi, /^\.cloud-sandbox-up\.failed$/m);
  assert.match(gi, /^\.cursor-cloud-up\.done$/m);
  assert.match(gi, /^\.cursor-cloud-up\.failed$/m);
});
