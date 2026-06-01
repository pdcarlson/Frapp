#!/usr/bin/env node

// Decision logic for the `claude-review-gate` required check (ADR-14, amended #599).
//
// Policy: a REQUIRED review must actually complete. The gate BLOCKS when a review was
// *expected* (token present; not draft/fork/bot) but produced no FRESH verdict for the
// current head SHA — closing the hole where a transient action/API failure left a green
// required check with no review. It PASSES for intentional skips (no token, draft, fork,
// bot, override) and for a fresh verdict with important_count === 0. A fresh verdict is
// trusted even when the action process exited non-zero (flaky exit, action #846), so a
// completed-but-crashed review still counts — only a review that produced nothing blocks.
//
// Pure core (`evaluateGate`) + thin `main()` so the logic is unit-tested by
// scripts/ci/__tests__/ (the `ci-scripts-tests` job). No npm dependencies.

import { fileURLToPath } from "node:url";

// Verdict marker emitted by the review (see the prompt in claude-review.yml):
//   <!-- claude-review-verdict: sha=<head_sha> important=N -->
// The sha scopes the verdict to a commit so a prior commit's verdict can't mask a failed run.
const VERDICT_RE = /claude-review-verdict:\s*sha=([0-9a-f]{7,40})\s+important=(\d+)/i;

export function parseStructuredImportant(structured) {
  if (!structured) return null;
  try {
    const v = JSON.parse(structured);
    if (v && Number.isInteger(v.important_count)) return v.important_count;
  } catch {
    /* malformed structured output — fall through to the comment marker */
  }
  return null;
}

// Important count from the most-recent comment whose verdict marker matches headSha,
// or null if none. Stale (other-SHA) or unmarked (legacy) verdicts are ignored.
export function parseImportantFromComments(comments, headSha) {
  if (!Array.isArray(comments) || !headSha) return null;
  let found = null;
  for (const body of comments) {
    if (typeof body !== "string") continue;
    const m = body.match(VERDICT_RE);
    if (m && m[1].toLowerCase() === headSha.toLowerCase()) {
      found = Number(m[2]); // comments arrive chronologically — last match wins
    }
  }
  return found;
}

// Pure decision. Returns { block: boolean, reason: string }.
export function evaluateGate({
  override = false,
  reviewResult = "",
  tokenPresent = false,
  structuredOutput = "",
  comments = [],
  headSha = "",
} = {}) {
  if (override) {
    return { block: false, reason: "'claude-review-override' label present — gate passes." };
  }
  // Intentional non-reviews are not failures.
  if (reviewResult === "skipped") {
    return { block: false, reason: "review job skipped (draft/fork/bot) — gate passes." };
  }
  // Advisory pass for "no token configured" applies ONLY when the review job completed cleanly
  // (`success`). A non-`success` result (cancelled by concurrency, or failed before the token step)
  // ALSO leaves `token_present` empty — but that's an INCOMPLETE review, not a missing token, so it
  // must fall through and be blocked unless a fresh verdict exists.
  if (reviewResult === "success" && !tokenPresent) {
    // Safe to return before the verdict check below: with no token the review step is skipped, so no
    // structured_output or SHA-matched verdict comment can exist for this run.
    return { block: false, reason: "no review token configured — gate passes (advisory)." };
  }

  // A real review was expected for this commit. Require a FRESH verdict.
  let important = parseStructuredImportant(structuredOutput);
  let source = "structured_output";
  if (important === null) {
    important = parseImportantFromComments(comments, headSha);
    source = "verdict comment";
  }

  if (important === null) {
    return {
      block: true,
      reason:
        `review was expected but produced no fresh verdict for ${headSha || "<unknown sha>"} ` +
        `(review job result=${reviewResult || "?"}). Re-run the review, or add the ` +
        `'claude-review-override' label to bypass.`,
    };
  }
  if (important > 0) {
    return {
      block: true,
      reason:
        `review reported ${important} Important finding(s) (${source}) — blocking merge. ` +
        `Resolve them, or add 'claude-review-override'.`,
    };
  }
  return { block: false, reason: `review complete, 0 Important findings (${source}) — gate passes.` };
}

function boolEnv(value) {
  return String(value).toLowerCase() === "true";
}

function main() {
  let comments = [];
  try {
    comments = JSON.parse(process.env.COMMENTS_JSON || "[]");
  } catch {
    comments = [];
  }
  const result = evaluateGate({
    override: boolEnv(process.env.OVERRIDE),
    reviewResult: process.env.REVIEW_RESULT || "",
    tokenPresent: boolEnv(process.env.TOKEN_PRESENT),
    structuredOutput: process.env.STRUCTURED || "",
    comments,
    headSha: process.env.HEAD_SHA || "",
  });
  if (result.block) {
    console.log(`::error::Claude review gate — ${result.reason}`);
    process.exit(1);
  }
  console.log(`::notice::Claude review gate — ${result.reason}`);
}

// Execute only as the CLI entry point (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
