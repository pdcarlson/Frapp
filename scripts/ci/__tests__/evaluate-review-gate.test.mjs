import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  evaluateGate,
  parseImportantFromComments,
  parseStructuredImportant,
} from "../evaluate-review-gate.mjs";

const SCRIPT = fileURLToPath(new URL("../evaluate-review-gate.mjs", import.meta.url));

// Run the CLI entry point with the given env and capture stdout. Asserts it always exits 0
// (the workflow relies on the printed `gate_state`, not the exit code, to post the commit status).
function runMain(env) {
  return execFileSync("node", [SCRIPT], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

const SHA = "abc1234def5678abc1234def5678abc1234def56"; // 40-char hex (current head)
const OTHER_SHA = "deadbeef9999deadbeef9999deadbeef9999dead"; // a different commit

const verdict = (sha, n) => `summary text\n<!-- claude-review-verdict: sha=${sha} important=${n} -->`;

// ── Intentional non-reviews pass ────────────────────────────────────────────

test("override label always passes (even on a failed review)", () => {
  const r = evaluateGate({ override: true, reviewResult: "failure", tokenPresent: true, headSha: SHA });
  assert.equal(r.block, false);
});

test("skipped review job (non-fork: labeled/no-op) passes", () => {
  const r = evaluateGate({ reviewResult: "skipped", tokenPresent: false, headSha: SHA });
  assert.equal(r.block, false);
});

test("BLOCKS a fork PR whose review was skipped (no fail-open via on-demand @claude review)", () => {
  // A fork reaches the gate only via an `@claude review` comment; the review job skips forks, so a
  // skipped+fork verdict means nothing was reviewed — must not post a green required status.
  const r = evaluateGate({ reviewResult: "skipped", isFork: true, headSha: SHA });
  assert.equal(r.block, true);
});

test("a fork PR with the override label still passes (trusted-fork escape hatch)", () => {
  const r = evaluateGate({ override: true, reviewResult: "skipped", isFork: true, headSha: SHA });
  assert.equal(r.block, false);
});

test("no token configured passes (advisory)", () => {
  const r = evaluateGate({ reviewResult: "success", tokenPresent: false, headSha: SHA });
  assert.equal(r.block, false);
});

test("BLOCKS a CANCELLED review even though token_present is empty (concurrency superseded it)", () => {
  // The bug: a cancelled/early-failed review leaves token_present empty; the old `!tokenPresent`
  // check mistook that for "no token configured" and greenlit an incomplete review.
  const r = evaluateGate({ reviewResult: "cancelled", tokenPresent: false, structuredOutput: "", comments: [], headSha: SHA });
  assert.equal(r.block, true);
});

test("BLOCKS a FAILED review with empty token_present and no verdict (not a clean no-token skip)", () => {
  const r = evaluateGate({ reviewResult: "failure", tokenPresent: false, structuredOutput: "", comments: [], headSha: SHA });
  assert.equal(r.block, true);
});

test("the no-token advisory pass requires a SUCCESSFUL review job", () => {
  assert.equal(evaluateGate({ reviewResult: "success", tokenPresent: false, headSha: SHA }).block, false);
  assert.equal(evaluateGate({ reviewResult: "cancelled", tokenPresent: false, headSha: SHA }).block, true);
  assert.equal(evaluateGate({ reviewResult: "failure", tokenPresent: false, headSha: SHA }).block, true);
});

// ── The hole this fix closes ────────────────────────────────────────────────

test("BLOCKS when review failed and produced no verdict (the 29s transient case)", () => {
  const r = evaluateGate({
    reviewResult: "failure",
    tokenPresent: true,
    structuredOutput: "",
    comments: [],
    headSha: SHA,
  });
  assert.equal(r.block, true);
});

test("does NOT pass on a STALE verdict from a different commit", () => {
  // This is precisely today's bug: run #1 posted important=0, run #2 failed.
  const r = evaluateGate({
    reviewResult: "failure",
    tokenPresent: true,
    structuredOutput: "",
    comments: [verdict(OTHER_SHA, 0)],
    headSha: SHA,
  });
  assert.equal(r.block, true);
});

test("ignores a legacy (sha-less) verdict marker and blocks", () => {
  const r = evaluateGate({
    reviewResult: "failure",
    tokenPresent: true,
    comments: ["old run\n<!-- claude-review-verdict: important=0 -->"],
    headSha: SHA,
  });
  assert.equal(r.block, true);
});

// ── Fresh verdicts decide correctly ─────────────────────────────────────────

test("passes on fresh structured_output important=0", () => {
  const r = evaluateGate({
    reviewResult: "success",
    tokenPresent: true,
    structuredOutput: JSON.stringify({ important_count: 0, summary: "ok" }),
    headSha: SHA,
  });
  assert.equal(r.block, false);
});

test("BLOCKS on fresh structured_output important>0", () => {
  const r = evaluateGate({
    reviewResult: "success",
    tokenPresent: true,
    structuredOutput: JSON.stringify({ important_count: 2 }),
    headSha: SHA,
  });
  assert.equal(r.block, true);
});

test("trusts a fresh SHA-matched comment verdict even if the action exited non-zero (#846)", () => {
  const r = evaluateGate({
    reviewResult: "failure", // flaky exit AFTER posting the verdict
    tokenPresent: true,
    structuredOutput: "",
    comments: [verdict(SHA, 0)],
    headSha: SHA,
  });
  assert.equal(r.block, false);
});

test("BLOCKS on a fresh comment verdict important>0 even if the action exited non-zero", () => {
  const r = evaluateGate({
    reviewResult: "failure",
    tokenPresent: true,
    comments: [verdict(SHA, 3)],
    headSha: SHA,
  });
  assert.equal(r.block, true);
});

// ── Parsers ─────────────────────────────────────────────────────────────────

test("parseImportantFromComments picks the LAST matching-sha verdict", () => {
  const comments = [verdict(SHA, 2), verdict(SHA, 0)];
  assert.equal(parseImportantFromComments(comments, SHA), 0);
});

test("parseImportantFromComments ignores other-sha verdicts", () => {
  assert.equal(parseImportantFromComments([verdict(OTHER_SHA, 5)], SHA), null);
});

test("parseStructuredImportant handles malformed/empty JSON", () => {
  assert.equal(parseStructuredImportant("not json"), null);
  assert.equal(parseStructuredImportant(""), null);
  assert.equal(parseStructuredImportant(JSON.stringify({ important_count: 4 })), 4);
});

// ── main() output contract (the workflow posts this as the commit status; exit code is NOT used) ──

test("main() prints gate_state=success and exits 0 on a fresh important=0 verdict", () => {
  const out = runMain({
    REVIEW_RESULT: "success",
    TOKEN_PRESENT: "true",
    STRUCTURED: JSON.stringify({ important_count: 0, summary: "ok" }),
    HEAD_SHA: SHA,
    COMMENTS_JSON: "[]",
    OVERRIDE: "false",
  });
  assert.match(out, /^gate_state=success$/m);
  assert.match(out, /^gate_desc=/m);
});

test("main() prints gate_state=failure and STILL exits 0 when the gate blocks", () => {
  // A blocking verdict must not throw (execFileSync would throw on a non-zero exit) — the workflow
  // needs the printed state to post a `failure` commit status.
  const out = runMain({
    REVIEW_RESULT: "failure",
    TOKEN_PRESENT: "true",
    STRUCTURED: "",
    HEAD_SHA: SHA,
    COMMENTS_JSON: "[]",
    OVERRIDE: "false",
  });
  assert.match(out, /^gate_state=failure$/m);
});

test("main() honours the override env (sourced from the context job's gh pr view, not the PR event)", () => {
  const out = runMain({
    REVIEW_RESULT: "skipped",
    TOKEN_PRESENT: "false",
    HEAD_SHA: SHA,
    COMMENTS_JSON: "[]",
    OVERRIDE: "true",
  });
  assert.match(out, /^gate_state=success$/m);
});
