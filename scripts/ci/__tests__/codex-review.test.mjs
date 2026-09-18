import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CODEX_REVIEW_MARKER,
  MAX_COMMENT_CHARS,
  buildCommentBody,
  capBody,
  checkContract,
  classifyReview,
  findRawModelMessage,
  hasRenderedFindings,
  postReview,
  relativizePaths,
  sanitizeMentions,
} from "../codex-review.mjs";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Every string below is what `codex review` 0.155.0 ACTUALLY printed when run
// against a local Responses-API stub. They are transcribed, not invented, which
// is the point: the classifier's whole job is telling these shapes apart.

/** Valid JSON, two findings. Note the plural section header. */
const RENDERED_TWO = `Two defects.

Full review comments:

- [P0] Null deref — /home/runner/work/Frapp/Frapp/apps/api/src/a.ts:1-1
  First.

- [P2] Naming — /home/runner/work/Frapp/Frapp/apps/api/src/b.ts:5-7
  Second.`;

/** Valid JSON, one finding. Singular header — the wording differs. */
const RENDERED_ONE = `One P1 defect.

Review comment:

- [P1] Guard against empty slice — /home/runner/work/Frapp/Frapp/a.txt:1-2
  The loop indexes past the end when input is empty.`;

/** Valid JSON, zero findings: only overall_explanation is rendered. */
const RENDERED_CLEAN = "No issues found.";

/** A model that ignored the schema. Same shape as RENDERED_CLEAN. */
const RENDERED_GARBAGE = "Sure! I reviewed it. Looks fine to me, no issues. Hope that helps!";

const VALID_RAW = JSON.stringify({
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "No issues found.",
  overall_confidence_score: 0.9,
});

// ── hasRenderedFindings ─────────────────────────────────────────────────────

test("hasRenderedFindings keys on the bullet, not the section header wording", () => {
  assert.equal(hasRenderedFindings(RENDERED_ONE), true, "singular header");
  assert.equal(hasRenderedFindings(RENDERED_TWO), true, "plural header");
  assert.equal(hasRenderedFindings(RENDERED_CLEAN), false);
  assert.equal(hasRenderedFindings(RENDERED_GARBAGE), false);
  assert.equal(hasRenderedFindings(""), false);
  assert.equal(hasRenderedFindings(undefined), false);
});

test("hasRenderedFindings accepts every priority level and rejects near-misses", () => {
  for (const p of [0, 1, 2, 3]) {
    assert.equal(hasRenderedFindings(`- [P${p}] t — /x:1-1`), true, `P${p}`);
  }
  // Prose that merely mentions a priority tag is not a rendered finding.
  assert.equal(hasRenderedFindings("I would call this a [P1] issue."), false);
  assert.equal(hasRenderedFindings("- [P4] out of range — /x:1-1"), false);
});

// ── checkContract ───────────────────────────────────────────────────────────

test("checkContract distinguishes schema output from prose, and unknown from false", () => {
  assert.equal(checkContract(VALID_RAW), true);
  assert.equal(checkContract(RENDERED_GARBAGE), false, "prose violates the contract");
  // null means "no claim made" — it must never be conflated with false, because
  // false raises an alert and null does not.
  assert.equal(checkContract(null), null, "unreadable rollout");
  assert.equal(checkContract(""), null);
  assert.equal(checkContract("   "), null);
});

test("checkContract tolerates fences but still requires the schema's own keys", () => {
  assert.equal(checkContract("```json\n" + VALID_RAW + "\n```"), true);
  assert.equal(checkContract("```\n" + VALID_RAW + "\n```"), true);
  // Valid JSON that is not the review schema is a violation, not a pass.
  assert.equal(checkContract('{"hello":"world"}'), false);
  assert.equal(checkContract('{"findings":[]}'), false, "missing overall_correctness");
  assert.equal(checkContract('{"overall_correctness":"x"}'), false, "missing findings");
  assert.equal(checkContract('{"findings":"nope","overall_correctness":"x"}'), false);
  assert.equal(checkContract("[]"), false, "array is not the schema object");
  assert.equal(checkContract("null"), false);
});

// ── classifyReview ──────────────────────────────────────────────────────────

test("a non-zero exit is always a reviewer failure, whatever stdout says", () => {
  // 101 = missing provider env key, 1 = config error, 124 = the timeout fired.
  for (const exitCode of [1, 101, 124]) {
    const result = classifyReview({ exitCode, stdout: RENDERED_TWO, contractOk: true });
    assert.equal(result.verdict, "reviewer-failed", `exit ${exitCode}`);
    assert.equal(result.shouldAlert, true);
    assert.equal(result.shouldPost, false);
  }
});

test("exit 0 with empty stdout is a dead reviewer, not a clean review", () => {
  for (const stdout of ["", "   \n  ", undefined]) {
    const result = classifyReview({ exitCode: 0, stdout });
    assert.equal(result.verdict, "empty-output");
    assert.equal(result.shouldAlert, true);
    assert.equal(result.shouldPost, false);
  }
});

test("rendered findings post, and an unreadable rollout cannot downgrade them", () => {
  for (const contractOk of [true, false, null]) {
    const result = classifyReview({ exitCode: 0, stdout: RENDERED_TWO, contractOk });
    assert.equal(result.verdict, "findings", `contractOk=${contractOk}`);
    assert.equal(result.shouldPost, true);
    assert.equal(result.shouldAlert, false);
  }
});

test("THE case stdout cannot decide: clean vs contract violation", () => {
  // Both of these are non-empty prose at exit 0 and are byte-indistinguishable
  // by shape. Only the raw pre-render model message separates them, which is
  // the entire reason checkContract exists.
  const clean = classifyReview({ exitCode: 0, stdout: RENDERED_CLEAN, contractOk: true });
  assert.equal(clean.verdict, "clean");
  assert.equal(clean.shouldAlert, false);
  assert.equal(clean.shouldPost, false);

  const violation = classifyReview({
    exitCode: 0,
    stdout: RENDERED_GARBAGE,
    contractOk: false,
  });
  assert.equal(violation.verdict, "contract-violation");
  assert.equal(violation.shouldAlert, true, "a model ignoring the schema must alert");
  assert.equal(violation.shouldPost, false, "never post prose as a review");

  // Same two strings, contract unknown: both degrade to clean-unverified and
  // NEITHER alerts. Failing to read a rollout must not manufacture an alert.
  for (const stdout of [RENDERED_CLEAN, RENDERED_GARBAGE]) {
    const unknown = classifyReview({ exitCode: 0, stdout, contractOk: null });
    assert.equal(unknown.verdict, "clean-unverified");
    assert.equal(unknown.shouldAlert, false);
    assert.equal(unknown.shouldPost, false);
  }
});

test("exit code is compared numerically, so a string '0' is still success", () => {
  // CODEX_EXIT_CODE arrives from a GitHub step output, i.e. always a string.
  const result = classifyReview({ exitCode: "0", stdout: RENDERED_TWO, contractOk: true });
  assert.equal(result.verdict, "findings");
  const failure = classifyReview({ exitCode: "101", stdout: "", contractOk: null });
  assert.equal(failure.verdict, "reviewer-failed");
});

// ── sanitizeMentions ────────────────────────────────────────────────────────

test("mentions and cross-references are broken outside code", () => {
  const out = sanitizeMentions("Ping @octocat and @org/team, see owner/repo#42 plus #7 and GH-9.");
  assert.ok(!/@octocat/.test(out), "bare @mention must not survive");
  assert.ok(out.includes("@<!---->octocat"));
  assert.ok(out.includes("@<!---->org/team"));
  assert.ok(out.includes("#<!---->42"));
  assert.ok(out.includes("#<!---->7"));
  assert.ok(out.includes("GH-<!---->9"));
});

test("code is left byte-identical so suggestions stay copy-pasteable", () => {
  const fenced = "Text @a\n\n```ts\nconst x = \"@nobody\"; // #123\n```\n\nMore @b";
  const out = sanitizeMentions(fenced);
  assert.ok(out.includes('const x = "@nobody"; // #123'), "fenced block untouched");
  assert.ok(out.includes("@<!---->a"), "prose before the fence is sanitized");
  assert.ok(out.includes("@<!---->b"), "prose after the fence is sanitized");

  const inline = "Use `@decorator` here but not @here";
  const inlineOut = sanitizeMentions(inline);
  assert.ok(inlineOut.includes("`@decorator`"), "inline span untouched");
  assert.ok(inlineOut.includes("@<!---->here"));
});

test("sanitizeMentions leaves harmless text alone and never throws", () => {
  // An email-ish or decorative @ not followed by a word char is not a mention.
  assert.equal(sanitizeMentions("a @ b"), "a @ b");
  assert.equal(sanitizeMentions("issue # 5"), "issue # 5", "space breaks the ref");
  assert.equal(sanitizeMentions(""), "");
  assert.equal(sanitizeMentions(null), "");
  assert.equal(sanitizeMentions(undefined), "");
});

// ── relativizePaths ─────────────────────────────────────────────────────────

test("runner-absolute paths become repo-relative", () => {
  const ws = "/home/runner/work/Frapp/Frapp";
  assert.equal(relativizePaths(`${ws}/apps/api/src/a.ts:1-2`, ws), "apps/api/src/a.ts:1-2");
  assert.ok(!relativizePaths(RENDERED_TWO, ws).includes(ws));
  // No workspace configured: pass through rather than guess.
  assert.equal(relativizePaths("/abs/x.ts", undefined), "/abs/x.ts");
  assert.equal(relativizePaths("", ws), "");
});

// ── capBody ─────────────────────────────────────────────────────────────────

test("capBody enforces GitHub's limit and says it truncated", () => {
  const long = "x".repeat(MAX_COMMENT_CHARS + 5000);
  const out = capBody(long);
  assert.ok(out.length <= MAX_COMMENT_CHARS, `got ${out.length}`);
  assert.match(out, /Truncated/);
  // Under the limit is returned untouched.
  assert.equal(capBody("short"), "short");
  assert.equal(capBody("abc", 100), "abc");
});

test("buildCommentBody never exceeds the limit even on a huge review", () => {
  const body = buildCommentBody({
    review: "- [P1] t — /w/x.ts:1-1\n  " + "y".repeat(MAX_COMMENT_CHARS * 2),
    headSha: "abc1234",
    runUrl: "https://example.test/run",
    model: "meta/muse-spark-1.3",
    workspace: "/w",
  });
  assert.ok(body.length <= MAX_COMMENT_CHARS, `got ${body.length}`);
});

// ── buildCommentBody ────────────────────────────────────────────────────────

test("the comment carries its marker, is advisory, and sanitizes the review", () => {
  const body = buildCommentBody({
    review: RENDERED_ONE + "\n  Ping @octocat re owner/repo#42.",
    headSha: "deadbee",
    runUrl: "https://example.test/run/1",
    model: "meta/muse-spark-1.3",
    workspace: "/home/runner/work/Frapp/Frapp",
  });
  assert.ok(body.startsWith(CODEX_REVIEW_MARKER), "marker must lead for the upsert");
  assert.match(body, /advisory/i);
  assert.match(body, /blocks nothing|not a required check/i);
  assert.match(body, /deadbee/);
  assert.match(body, /\[P1\] Guard against empty slice/);
  assert.ok(body.includes("a.txt:1-2"), "path relativized");
  assert.ok(!body.includes("/home/runner/work"), "no runner paths leak");
  assert.ok(!/@octocat/.test(body), "mentions neutralized");
  assert.match(body, /meta\/muse-spark-1\.3/);
  assert.match(body, /example\.test\/run\/1/);
});

test("buildCommentBody omits the footer when there is nothing to put in it", () => {
  const body = buildCommentBody({ review: RENDERED_CLEAN, headSha: "abc" });
  assert.ok(body.startsWith(CODEX_REVIEW_MARKER));
  assert.ok(!body.includes("<sub>"));
});

// ── findRawModelMessage ─────────────────────────────────────────────────────

test("findRawModelMessage reads the newest agent_message out of a rollout tree", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  try {
    const day = join(home, "sessions", "2026", "09", "18");
    mkdirSync(day, { recursive: true });
    // Transcribed rollout shape: the raw reply lands in an event_msg whose
    // payload.type is agent_message, before anything is rendered.
    writeFileSync(
      join(day, "rollout-a.jsonl"),
      [
        JSON.stringify({ type: "session_meta", payload: { type: "session_meta" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "go" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: VALID_RAW } }),
      ].join("\n"),
    );
    assert.equal(findRawModelMessage(home), VALID_RAW);
    assert.equal(checkContract(findRawModelMessage(home)), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("findRawModelMessage degrades to null instead of throwing", () => {
  assert.equal(findRawModelMessage(undefined), null, "no CODEX_HOME");
  assert.equal(findRawModelMessage("/definitely/not/here"), null, "missing sessions dir");

  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  try {
    const day = join(home, "sessions", "2026", "09", "18");
    mkdirSync(day, { recursive: true });
    assert.equal(findRawModelMessage(home), null, "no rollout files");
    // Corrupt lines and rollouts with no agent_message must not throw, and must
    // not be mistaken for a contract violation.
    writeFileSync(join(day, "rollout-b.jsonl"), "not json\n{}\n{\"payload\":null}\n");
    assert.equal(findRawModelMessage(home), null);
    assert.equal(checkContract(findRawModelMessage(home)), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── postReview ──────────────────────────────────────────────────────────────

/**
 * Records every GitHub call. Returns 200 + [] for listings so the alert lookup
 * and the stale-comment scan both find nothing.
 */
function makeFetchSpy({ existingComments = [], existingIssues = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
    let payload = [];
    if (method === "GET" && /\/issues\/\d+\/comments/.test(url)) payload = existingComments;
    else if (method === "GET" && /\/issues\?/.test(url)) payload = existingIssues;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    };
  };
  return { calls, fetchImpl };
}

const BASE_ARGS = {
  token: "t",
  repo: "pdcarlson/Frapp",
  prNumber: 123,
  headSha: "abc1234",
  workspace: "/home/runner/work/Frapp/Frapp",
  runUrl: "https://example.test/run",
  model: "meta/muse-spark-1.3",
  logger: { log() {} },
};

test("findings are posted as a plain issue comment and never as a review", async () => {
  const { calls, fetchImpl } = makeFetchSpy();
  const result = await postReview({
    ...BASE_ARGS,
    exitCode: 0,
    stdout: RENDERED_TWO,
    fetchImpl,
  });
  assert.equal(result.verdict, "findings");
  assert.equal(result.commented, true);
  assert.equal(result.alerted, false);

  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1, "exactly one write");
  assert.match(posts[0].url, /\/issues\/123\/comments$/);
  // The #1875 invariant: no review endpoint may ever be touched.
  for (const call of calls) {
    assert.ok(!/\/pulls\/\d+\/reviews/.test(call.url), `review endpoint hit: ${call.url}`);
  }
  assert.ok(posts[0].body.body.startsWith(CODEX_REVIEW_MARKER));
});

test("a clean review posts nothing but still clears a stale comment", async () => {
  const stale = [{ id: 9, body: `${CODEX_REVIEW_MARKER}\nold findings` }];
  const { calls, fetchImpl } = makeFetchSpy({ existingComments: stale });
  const result = await postReview({
    ...BASE_ARGS,
    exitCode: 0,
    stdout: RENDERED_CLEAN,
    codexHome: undefined, // contract unknown -> clean-unverified
    fetchImpl,
  });
  assert.equal(result.verdict, "clean-unverified");
  assert.equal(result.commented, false);
  assert.equal(result.alerted, false);
  assert.ok(
    calls.some((c) => c.method === "DELETE" && /\/issues\/comments\/9$/.test(c.url)),
    "the stale review comment must be removed once it no longer applies",
  );
  assert.ok(
    !calls.some((c) => c.method === "POST" && /\/issues\/123\/comments$/.test(c.url)),
    "a clean run must not add a comment",
  );
});

test("a reviewer failure files one alert issue and posts no review", async () => {
  const { calls, fetchImpl } = makeFetchSpy();
  const result = await postReview({
    ...BASE_ARGS,
    exitCode: 101,
    stdout: "",
    fetchImpl,
  });
  assert.equal(result.verdict, "reviewer-failed");
  assert.equal(result.alerted, true);
  assert.equal(result.commented, false);

  const created = calls.filter((c) => c.method === "POST" && /\/issues$/.test(c.url));
  assert.equal(created.length, 1, "exactly one alert issue");
  assert.ok(created[0].body.labels.includes("routine-state"), "must be never-claimable");
  assert.match(created[0].body.body, /OPENROUTER_API_KEY/);
  assert.match(created[0].body.body, /meta\/muse-spark-1\.3/, "names the correct slug form");
  assert.ok(
    !calls.some((c) => c.method === "POST" && /\/issues\/123\/comments$/.test(c.url)),
    "a failed reviewer must not comment on the PR",
  );
});

test("a contract violation alerts rather than posting the model's prose", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  try {
    const day = join(home, "sessions", "2026", "09", "18");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-a.jsonl"),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "agent_message", message: RENDERED_GARBAGE },
      }),
    );
    const { calls, fetchImpl } = makeFetchSpy();
    const result = await postReview({
      ...BASE_ARGS,
      exitCode: 0,
      stdout: RENDERED_GARBAGE,
      codexHome: home,
      fetchImpl,
    });
    assert.equal(result.verdict, "contract-violation");
    assert.equal(result.alerted, true);
    assert.equal(result.commented, false);
    const commentPosts = calls.filter(
      (c) => c.method === "POST" && /\/issues\/123\/comments$/.test(c.url),
    );
    assert.equal(commentPosts.length, 0, "prose must never reach the PR as a review");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a recovered run closes the open alert", async () => {
  const openAlert = [
    { number: 55, title: "Advisory codex review is not producing reviews", state: "open" },
  ];
  const { calls, fetchImpl } = makeFetchSpy({ existingIssues: openAlert });
  const result = await postReview({
    ...BASE_ARGS,
    exitCode: 0,
    stdout: RENDERED_TWO,
    fetchImpl,
  });
  assert.equal(result.verdict, "findings");
  const closed = calls.find((c) => c.method === "PATCH" && /\/issues\/55$/.test(c.url));
  assert.ok(closed, "the alert must close when the reviewer works again");
  assert.equal(closed.body.state, "closed");
});
