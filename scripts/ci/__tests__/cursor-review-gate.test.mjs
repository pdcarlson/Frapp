import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tests for .cursor/hooks/pre-push-review-gate.sh — Cursor beforeShellExecution
// adapter around the Claude PreToolUse gate. Lives next to review-gate.test.mjs
// so `test:ci-scripts` / ci-scripts-tests actually run it.
const ADAPTER = fileURLToPath(
  new URL("../../../.cursor/hooks/pre-push-review-gate.sh", import.meta.url),
);
const HOOKS_JSON = fileURLToPath(new URL("../../../.cursor/hooks.json", import.meta.url));

let repo;
let headSha;

before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "cursor-review-gate-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(repo, "f.txt"), "hello\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  headSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
});

function runAdapter(command, { raw = false, cwd = repo, env = {} } = {}) {
  const payload = raw
    ? command
    : JSON.stringify({ command, cwd, sandbox: false });
  const tmp = mkdtempSync(path.join(tmpdir(), "crg-tmp-"));
  const res = spawnSync("bash", [ADAPTER], {
    input: payload,
    encoding: "utf8",
    env: {
      ...process.env,
      TMPDIR: tmp,
      ...env,
    },
  });
  rmSync(tmp, { recursive: true, force: true });
  return res;
}

function parseOut(res, label) {
  assert.equal(res.status, 0, `${label}: adapter should exit 0, got ${res.status} (stderr: ${res.stderr})`);
  assert.notEqual(res.stdout.trim(), "", `${label}: fail-closed adapter must never emit empty stdout`);
  return JSON.parse(res.stdout);
}

function assertCursorAllow(res, label) {
  const parsed = parseOut(res, label);
  assert.equal(parsed.permission, "allow", `${label}: expected allow, got ${JSON.stringify(parsed)}`);
}

function assertCursorDeny(res, label) {
  const parsed = parseOut(res, label);
  assert.equal(parsed.permission, "deny", `${label}: expected deny, got ${JSON.stringify(parsed)}`);
  assert.ok(
    typeof parsed.user_message === "string" && parsed.user_message.length > 0,
    `${label}: deny must carry a non-empty user_message`,
  );
  assert.ok(
    typeof parsed.agent_message === "string" && parsed.agent_message.length > 0,
    `${label}: deny must carry a non-empty agent_message`,
  );
}

const marker = () => path.join(repo, ".cache", "diff-review", headSha);
const writeMarker = () => {
  mkdirSync(path.dirname(marker()), { recursive: true });
  writeFileSync(marker(), "");
};
const clearMarker = () => rmSync(path.join(repo, ".cache"), { recursive: true, force: true });

test("hooks.json sets failClosed true on beforeShellExecution", () => {
  const cfg = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
  assert.equal(cfg.version, 1);
  const hooks = cfg.hooks.beforeShellExecution;
  assert.ok(Array.isArray(hooks) && hooks.length >= 1, "beforeShellExecution must be a non-empty array");
  const gate = hooks.find((h) => String(h.command).includes("pre-push-review-gate"));
  assert.ok(gate, "hooks.json must wire the review-gate adapter");
  assert.equal(gate.failClosed, true, "Cursor defaults fail-open; this gate must set failClosed: true");
});

for (const cmd of ["git push", "git push -u origin br", "git -C /repo push", "cd x && git push"]) {
  test(`Cursor payload denies unreviewed: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertCursorDeny(runAdapter(cmd), cmd);
  });
}

for (const cmd of ["ls -la", 'git commit -m "wire up push notifications"', "git push --dry-run"]) {
  test(`Cursor payload allows non-publishing: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertCursorAllow(runAdapter(cmd), cmd);
  });
}

test("Cursor payload allows git push once the marker exists for HEAD", () => {
  writeMarker();
  assertCursorAllow(runAdapter("git push"), "marker present");
  clearMarker();
});

test("malformed Cursor payload containing push is denied (fail-closed parse)", () => {
  assertCursorDeny(runAdapter("{not json, but git push is in here", { raw: true }), "malformed push");
});

test("malformed Cursor payload with no push token is allowed", () => {
  assertCursorAllow(runAdapter("{not json at all}", { raw: true }), "malformed non-push");
});

test("adapter stdout is always parseable JSON (allow path)", () => {
  clearMarker();
  const parsed = parseOut(runAdapter("ls"), "json allow");
  assert.equal(parsed.permission, "allow");
});

test("FRAPP_SKIP_REVIEW_GATE=1 allows an unreviewed git push (documented bypass)", () => {
  clearMarker();
  assertCursorAllow(
    runAdapter("git push", { env: { FRAPP_SKIP_REVIEW_GATE: "1" } }),
    "skip env",
  );
});

test("denied push carries a review-gate reason from the inner hook", () => {
  clearMarker();
  const parsed = parseOut(runAdapter("git push"), "deny reason");
  assert.equal(parsed.permission, "deny");
  assert.match(parsed.user_message, /review/i);
});

test("gitignore tracks Cursor hook files (not only environment.json)", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const res = spawnSync(
    "git",
    ["check-ignore", ".cursor/hooks.json", ".cursor/hooks/pre-push-review-gate.sh", ".cursor/commands/next.md"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    res.status,
    1,
    `hook contract files must not be gitignored (status ${res.status}; stdout=${res.stdout} stderr=${res.stderr})`,
  );
});
