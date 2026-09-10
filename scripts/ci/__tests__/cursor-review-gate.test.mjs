import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
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

test("inner hook crash on git push is denied (not Cursor-allow)", () => {
  clearMarker();
  const crash = path.join(mkdtempSync(path.join(tmpdir(), "crg-crash-")), "inner.sh");
  writeFileSync(crash, "#!/bin/bash\nexit 1\n");
  execFileSync("chmod", ["+x", crash]);
  assertCursorDeny(
    runAdapter("git push", { env: { FRAPP_REVIEW_GATE_INNER: crash } }),
    "inner crash push",
  );
  assertCursorAllow(
    runAdapter("ls -la", { env: { FRAPP_REVIEW_GATE_INNER: crash } }),
    "inner crash non-push",
  );
});

test("JSON string payload containing push is denied (not an object parse success)", () => {
  assertCursorDeny(runAdapter('"git push"', { raw: true }), "json string push");
});

test("JSON array payload containing push is denied", () => {
  assertCursorDeny(runAdapter('["git","push"]', { raw: true }), "json array push");
});

test("object payload with empty command and push token is denied", () => {
  assertCursorDeny(
    runAdapter(JSON.stringify({ command: null, note: "git push", cwd: repo, sandbox: false }), {
      raw: true,
    }),
    "null command",
  );
});

test("whitespace-only command with push token in the body is denied", () => {
  assertCursorDeny(
    runAdapter(JSON.stringify({ command: "  \t  ", note: "git push", cwd: repo, sandbox: false }), {
      raw: true,
    }),
    "whitespace command",
  );
});

test("whitespace-only command with no push token is allowed", () => {
  assertCursorAllow(
    runAdapter(JSON.stringify({ command: "  \t  ", cwd: repo, sandbox: false }), { raw: true }),
    "whitespace non-push",
  );
});

test("newline-only command with push token in the body is denied", () => {
  assertCursorDeny(
    runAdapter(JSON.stringify({ command: "\n", note: "git push", cwd: repo, sandbox: false }), {
      raw: true,
    }),
    "newline command",
  );
});

test("NBSP-only command with push token in the body is denied", () => {
  assertCursorDeny(
    runAdapter(
      JSON.stringify({ command: "\u00a0", note: "git push", cwd: repo, sandbox: false }),
      { raw: true },
    ),
    "nbsp command",
  );
});

test("object payload with non-string command array is denied", () => {
  assertCursorDeny(
    runAdapter(JSON.stringify({ command: ["git", "push"], cwd: repo, sandbox: false }), {
      raw: true,
    }),
    "command array field",
  );
});

test("missing INNER denies git push and allows ls", () => {
  clearMarker();
  const missing = path.join(mkdtempSync(path.join(tmpdir(), "crg-missing-")), "nope.sh");
  assertCursorDeny(
    runAdapter("git push", { env: { FRAPP_REVIEW_GATE_INNER: missing } }),
    "missing inner push",
  );
  assertCursorAllow(
    runAdapter("ls -la", { env: { FRAPP_REVIEW_GATE_INNER: missing } }),
    "missing inner non-push",
  );
});

test("FRAPP_SKIP_REVIEW_GATE=1 allows a malformed push payload (session env)", () => {
  assertCursorAllow(
    runAdapter("{not json, but git push is in here", {
      raw: true,
      env: { FRAPP_SKIP_REVIEW_GATE: "1" },
    }),
    "skip malformed",
  );
});

test("untranslatable inner stdout on git push is denied", () => {
  clearMarker();
  const noisy = path.join(mkdtempSync(path.join(tmpdir(), "crg-noisy-")), "inner.sh");
  writeFileSync(noisy, "#!/bin/bash\necho 'log line then deny'\necho '{\"hookSpecificOutput\":{\"permissionDecision\":\"deny\"}}'\nexit 0\n");
  execFileSync("chmod", ["+x", noisy]);
  assertCursorDeny(
    runAdapter("git push", { env: { FRAPP_REVIEW_GATE_INNER: noisy } }),
    "noisy inner push",
  );
});

const STUB_BINS = [
  "bash",
  "cat",
  "grep",
  "mkdir",
  "dirname",
  "id",
  "git",
  "rm",
  "sed",
  "env",
  "node",
  "python3",
  "mktemp",
  "chmod",
];

function makeStub(keep) {
  const dir = mkdtempSync(path.join(tmpdir(), "crg-stub-"));
  for (const bin of keep) {
    const src = spawnSync("bash", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
    assert.ok(src && src.startsWith("/"), `stub needs a real path for ${bin}, got ${JSON.stringify(src)}`);
    symlinkSync(src, path.join(dir, bin));
  }
  return dir;
}

test("node path still denies unreviewed git push when python3 is absent", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3"));
  const parsed = parseOut(
    runAdapter("git push", { env: { PATH: stub } }),
    "no python3 push",
  );
  assert.equal(parsed.permission, "deny");
  assert.match(parsed.user_message, /review/i);
  assertCursorAllow(runAdapter("ls -la", { env: { PATH: stub } }), "no python3 non-push");
  rmSync(stub, { recursive: true, force: true });
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

test("gitignore still ignores secrets under un-ignored .cursor contract dirs", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const res = spawnSync(
    "git",
    ["check-ignore", "--no-index", ".cursor/hooks/.env", ".cursor/commands/mcp.json", ".cursor/hooks/id.pem"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    res.status,
    0,
    `secret filenames under .cursor/hooks|commands must stay ignored (status ${res.status}; stdout=${res.stdout} stderr=${res.stderr})`,
  );
});
