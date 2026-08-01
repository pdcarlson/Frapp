import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tests for .claude/hooks/pre-push-review-gate.sh — a shell hook, not a JS module, so this
// drives it as a subprocess. It lives here (rather than beside the hook) so the existing
// `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs) and the ci-scripts-tests CI job pick
// it up; a standalone script next to the hook is never run by anything and rots, which is how
// the fail-open parse bug below survived unnoticed in the first place.
const HOOK = fileURLToPath(new URL("../../../.claude/hooks/pre-push-review-gate.sh", import.meta.url));

// Every case runs against a THROWAWAY git repo. Pointing the hook at the real working tree
// would make the suite read and write the live .cache/diff-review/<HEAD_SHA> marker that the
// production gate trusts — deleting a developer's genuine review evidence, and (worse) leaving
// a forged marker behind on an interrupted run, which opens the real gate for that HEAD.
let repo;
let headSha;

before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "review-gate-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(repo, "f.txt"), "hello\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  headSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
});

after(() => rmSync(repo, { recursive: true, force: true }));

function runHook(command, { env = {}, pathOverride, transcriptPath = "", raw = false } = {}) {
  // `raw` sends the argument to the hook verbatim, for the malformed-payload cases. Without it
  // a "malformed" string would just be JSON-wrapped into a perfectly valid payload and the case
  // would assert nothing — which is exactly what an earlier revision of this file did.
  const payload = raw
    ? command
    : JSON.stringify({ tool_input: { command }, transcript_path: transcriptPath });
  // A fresh TMPDIR per call keeps the livelock attempt counter from leaking between cases.
  const tmp = mkdtempSync(path.join(tmpdir(), "rg-tmp-"));
  const res = spawnSync("bash", [HOOK], {
    input: payload,
    encoding: "utf8",
    env: {
      ...(pathOverride ? { PATH: pathOverride } : process.env),
      TMPDIR: tmp,
      CLAUDE_PROJECT_DIR: repo,
      ...env,
    },
  });
  rmSync(tmp, { recursive: true, force: true });
  return res;
}

// The hook communicates only through stdout; it must always exit 0 so it never breaks the tool
// call itself. Deriving "allow" from the mere absence of "deny" would let a crashed hook score
// as a passing allow, so assert the exit status and the emptiness of stdout explicitly.
function assertAllow(res, label) {
  assert.equal(res.status, 0, `${label}: hook should exit 0, got ${res.status} (stderr: ${res.stderr})`);
  assert.equal(res.stdout.trim(), "", `${label}: expected no decision, got ${res.stdout}`);
}

function assertDeny(res, label) {
  assert.equal(res.status, 0, `${label}: hook should exit 0, got ${res.status} (stderr: ${res.stderr})`);
  const parsed = JSON.parse(res.stdout); // also proves the emitted JSON is well-formed
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny", `${label}: expected deny`);
  assert.ok(
    typeof parsed.hookSpecificOutput.permissionDecisionReason === "string" &&
      parsed.hookSpecificOutput.permissionDecisionReason.length > 0,
    `${label}: deny must carry a non-empty reason`,
  );
}

const marker = () => path.join(repo, ".cache", "diff-review", headSha);
const writeMarker = () => {
  mkdirSync(path.dirname(marker()), { recursive: true });
  writeFileSync(marker(), "");
};
const clearMarker = () => rmSync(path.join(repo, ".cache"), { recursive: true, force: true });

// ── Command-position matching ───────────────────────────────────────────────

for (const cmd of [
  "git push",
  "git push -u origin br",
  "git -C /repo push",
  "git -c user.name=x push",
  "cd x && git push",
  "cd x\ngit push",
  "git push --dry-run && git push origin main",
]) {
  test(`gates: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertDeny(runHook(cmd), cmd);
  });
}

for (const cmd of [
  "ls -la",
  'git commit -m "wire up push notifications"',
  'grep "git push" file',
  "git pushdeploy",
  "git push --dry-run",
  "cat README.md",
]) {
  test(`ignores: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertAllow(runHook(cmd), cmd);
  });
}

// ── Evidence marker ─────────────────────────────────────────────────────────

test("allows the push once the marker exists for HEAD", () => {
  writeMarker();
  assertAllow(runHook("git push"), "marker present");
  clearMarker();
});

test("a marker for a different SHA does not satisfy the gate", () => {
  clearMarker();
  mkdirSync(path.join(repo, ".cache", "diff-review"), { recursive: true });
  writeFileSync(path.join(repo, ".cache", "diff-review", "0".repeat(40)), "");
  assertDeny(runHook("git push"), "stale marker");
  clearMarker();
});

// ── Deliberate bypass, in both forms an agent will actually write ───────────

test("bypass via the hook's own environment", () => {
  clearMarker();
  assertAllow(runHook("git push", { env: { FRAPP_SKIP_REVIEW_GATE: "1" } }), "env bypass");
});

// These previously failed: the hook read only its own environment, so the documented
// "set FRAPP_SKIP_REVIEW_GATE=1 on the push" form was denied, and the prefix form appeared to
// work only because push_re declines to match an env-prefixed command at all.
for (const cmd of [
  "FRAPP_SKIP_REVIEW_GATE=1 git push",
  "export FRAPP_SKIP_REVIEW_GATE=1 && git push",
  "export FRAPP_SKIP_REVIEW_GATE=1; git push origin main",
]) {
  test(`bypass via command text: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertAllow(runHook(cmd), cmd);
  });
}

// ── Livelock guard: deny, but never wedge ───────────────────────────────────

test("releases with a warning after 4 blocked attempts for the same HEAD", () => {
  clearMarker();
  const tmp = mkdtempSync(path.join(tmpdir(), "rg-livelock-"));
  const run = () =>
    spawnSync("bash", [HOOK], {
      input: JSON.stringify({ tool_input: { command: "git push" }, transcript_path: "" }),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp, CLAUDE_PROJECT_DIR: repo },
    });
  for (let i = 1; i <= 4; i++) assertDeny(run(), `attempt ${i}`);
  const released = run();
  assert.equal(released.stdout.trim(), "", "5th attempt should be allowed through");
  assert.match(released.stderr, /UNREVIEWED/, "release must warn loudly on stderr");
  rmSync(tmp, { recursive: true, force: true });
});

// ── Fail-closed parsing ─────────────────────────────────────────────────────

const STUB_BINS = ["bash", "cat", "grep", "mkdir", "dirname", "id", "git", "rm", "sed", "env", "node", "python3"];

// Build a PATH containing only `keep`. Asserts every requested binary actually resolved — a
// stub that silently omits something the hook needs makes the hook die for the wrong reason,
// and an "allow" assertion would then pass vacuously.
function makeStub(keep) {
  const dir = mkdtempSync(path.join(tmpdir(), "rg-stub-"));
  for (const bin of keep) {
    const src = spawnSync("bash", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
    assert.ok(src && src.startsWith("/"), `stub needs a real path for ${bin}, got ${JSON.stringify(src)}`);
    symlinkSync(src, path.join(dir, bin));
  }
  return dir;
}

test("node parses the payload when python3 is absent", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3"));
  assertDeny(runHook("git push", { pathOverride: stub }), "no python3, push");
  assertAllow(runHook("ls -la", { pathOverride: stub }), "no python3, non-push");
  rmSync(stub, { recursive: true, force: true });
});

test("with no interpreter at all, a push is denied and an unrelated command is not", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3" && b !== "node"));
  assertDeny(runHook("git push origin main", { pathOverride: stub }), "no interpreter, push");
  assertAllow(runHook("cat README.md", { pathOverride: stub }), "no interpreter, unrelated");
  rmSync(stub, { recursive: true, force: true });
});

test("a malformed payload mentioning a push is denied, not silently allowed", () => {
  clearMarker();
  assertDeny(runHook("not json at all: git push origin main", { raw: true }), "malformed + push");
  assertAllow(runHook("not json at all: ls -la", { raw: true }), "malformed, no push");
});

// The regression this suite exists for: `! grep -q` cannot tell "no match" (status 1) from
// "grep is broken/absent" (2 or 127), so a broken environment used to allow a real push.
test("a broken grep fails closed rather than allowing the push", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3" && b !== "node" && b !== "grep"));
  assertDeny(runHook("git push origin main", { pathOverride: stub }), "no grep, push");
  rmSync(stub, { recursive: true, force: true });
});

test("the no-interpreter deny still counts toward the livelock release", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3" && b !== "node"));
  const tmp = mkdtempSync(path.join(tmpdir(), "rg-wedge-"));
  const run = () =>
    spawnSync("bash", [HOOK], {
      input: JSON.stringify({ tool_input: { command: "git push" }, transcript_path: "" }),
      encoding: "utf8",
      env: { PATH: stub, TMPDIR: tmp, CLAUDE_PROJECT_DIR: repo },
    });
  for (let i = 1; i <= 4; i++) assertDeny(run(), `unparseable attempt ${i}`);
  assert.equal(run().stdout.trim(), "", "must not wedge the session forever");
  rmSync(tmp, { recursive: true, force: true });
  rmSync(stub, { recursive: true, force: true });
});
