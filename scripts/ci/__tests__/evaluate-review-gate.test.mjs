import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGate,
  parseImportantFromComments,
  parseStructuredImportant,
} from "../evaluate-review-gate.mjs";

const SHA = "abc1234def5678abc1234def5678abc1234def56"; // 40-char hex (current head)
const OTHER_SHA = "deadbeef9999deadbeef9999deadbeef9999dead"; // a different commit

const verdict = (sha, n) => `summary text\n<!-- claude-review-verdict: sha=${sha} important=${n} -->`;

// ── Intentional non-reviews pass ────────────────────────────────────────────

test("override label always passes (even on a failed review)", () => {
  const r = evaluateGate({ override: true, reviewResult: "failure", tokenPresent: true, headSha: SHA });
  assert.equal(r.block, false);
});

test("skipped review job (draft/fork/bot) passes", () => {
  const r = evaluateGate({ reviewResult: "skipped", tokenPresent: false, headSha: SHA });
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
