import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT,
  BASE_SYNC_MARKER,
  MAX_PRS,
  MERGEABLE_POLL_ATTEMPTS,
  MERGEABLE_SETTLE_MS,
  UPDATE_BRANCH_STALLS_BEFORE_STOP,
  buildBehindComment,
  buildConflictComment,
  buildRenumberComment,
  compareBehindBy,
  fetchPrWithMergeable,
  CHECKS_START_GRACE_MS,
  MAX_AUTO_MERGE_PRS,
  MERGE_GRACE_MS,
  isHeadMoved,
  isInFlight,
  pickSlotOrder,
  processBaseMove,
  readRequiredChecks,
  sweepModeFor,
} from "../pr-base-sync.mjs";
import { ALL_REQUIRED_CHECKS, REQUIRE_UP_TO_DATE } from "../lib/required-checks.mjs";

const REPO = "pdcarlson/Frapp";
const BASE_REF = "main";
const BASE_SHA = "aabbccddeeff00112233445566778899aabbccdd";
// The sweep's clock in every test: an hour after the fixtures' timestamps, so
// neither slot grace applies unless a test sets a fresher time.
const NOW = Date.parse("2026-11-06T20:00:00Z");

// ── Fixtures ────────────────────────────────────────────────────────────────

function makePr(number, overrides = {}) {
  return {
    number,
    mergeable: true,
    mergeable_state: "behind",
    head: {
      ref: `claude/branch-${number}`,
      sha: `${number}`.padStart(40, "0"),
      repo: { full_name: REPO },
    },
    base: { ref: BASE_REF },
    ...overrides,
  };
}

import { makeFetchMock, quiet } from "./helpers.mjs";

// A sleep that returns immediately but records each requested delay.
function makeSleep() {
  const sleeps = [];
  return { sleep: async (ms) => void sleeps.push(ms), sleeps };
}

const listRoute = (prs) => ({
  method: "GET",
  path: `/pulls?base=${BASE_REF}`,
  body: prs,
});
const detailRoute = (pr) => ({
  method: "GET",
  path: `/pulls/${pr.number}`,
  body: pr,
});
const compareRoute = (headSha, behindBy) => ({
  method: "GET",
  path: `/compare/${BASE_REF}...${headSha}`,
  body: { behind_by: behindBy, ahead_by: 1 },
});
const emptyCommentsRoute = { method: "GET", path: "/comments", body: [] };

function sweep({
  routes,
  updateToken = null,
  fetchWrapper = (f) => f,
  logger = quiet,
  mode = "push",
  now = () => NOW,
  updateBranchTimeoutMs,
  // The tests below were written for the up-to-date rule and the slot it needs;
  // the ones for the rule off pass false.
  requireUpToDate = true,
  addedLines = null,
}) {
  const { fetchImpl, calls } = makeFetchMock(routes);
  const run = processBaseMove({
    requireUpToDate,
    token: "t",
    updateToken,
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl: fetchWrapper(fetchImpl),
    sleep: makeSleep().sleep,
    logger,
    mode,
    now,
    updateBranchTimeoutMs,
    addedLines,
  });
  return run.then((results) => ({ results, calls }));
}

// ── Comment builders ────────────────────────────────────────────────────────

test("conflict comment carries the marker, the base move, and merge instructions", () => {
  const body = buildConflictComment({
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    pr: makePr(7),
  });
  assert.ok(body.startsWith(BASE_SYNC_MARKER), "marker must lead the body");
  assert.match(body, /merge conflicts/);
  assert.match(body, /git merge origin\/main/);
  assert.ok(body.includes(BASE_SHA.slice(0, 7)));
});

test("behind comment names the reason auto-update did not happen", () => {
  const body = buildBehindComment({
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    pr: makePr(7),
    reason: "the head branch lives in a fork, which this sweep cannot push to",
  });
  assert.ok(body.startsWith(BASE_SYNC_MARKER));
  assert.match(body, /lives in a fork/);
  assert.match(body, /not\*\* auto-updated/);
});

// ── fetchPrWithMergeable polling ────────────────────────────────────────────

test("polls while mergeable is null and returns once it resolves", async () => {
  const pr = makePr(3);
  let hits = 0;
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/pulls/3",
      body: () => {
        hits += 1;
        return hits < 3 ? { ...pr, mergeable: null } : pr;
      },
    },
  ]);
  const { sleep, sleeps } = makeSleep();
  const got = await fetchPrWithMergeable({
    token: "t",
    repo: REPO,
    number: 3,
    fetchImpl,
    sleep,
  });
  assert.equal(got.mergeable, true);
  assert.equal(sleeps.length, 2, "one sleep per null verdict before success");
});

test("gives up (null) when mergeable never resolves within the poll budget", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/pulls/3", body: { ...makePr(3), mergeable: null } },
  ]);
  const got = await fetchPrWithMergeable({
    token: "t",
    repo: REPO,
    number: 3,
    fetchImpl,
    sleep: makeSleep().sleep,
  });
  assert.equal(got, null);
  assert.equal(calls.length, MERGEABLE_POLL_ATTEMPTS);
});

// ── compareBehindBy ─────────────────────────────────────────────────────────

test("compare failure returns null, not zero", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/compare/", status: 404, body: { message: "Not Found" } },
  ]);
  const got = await compareBehindBy({
    token: "t",
    repo: REPO,
    baseRef: BASE_REF,
    headSha: "deadbeef",
    fetchImpl,
  });
  assert.equal(got, null);
});

// ── Sweep: conflicted PR ────────────────────────────────────────────────────

test("conflicted PR gets a wake comment and never an update attempt", async () => {
  const pr = makePr(11, { mergeable: false, mergeable_state: "dirty" });
  const { results, calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), emptyCommentsRoute],
    updateToken: "pat",
  });
  assert.deepEqual(results, [{ number: 11, verdict: "conflict", action: "commented" }]);
  const posted = calls.find((c) => c.method === "POST" && c.url.includes("/issues/11/comments"));
  assert.ok(posted, "conflict wake comment must be posted");
  assert.match(JSON.parse(posted.body).body, /merge conflicts/);
  assert.ok(
    !calls.some((c) => c.url.includes("/update-branch")),
    "a conflicted PR must never be blind-updated",
  );
});

// A wake comment that fails to post is the one signal a conflicted PR's session
// gets, so the failure must not read as success (#3019).
function capture() {
  const lines = [];
  return { logger: { log: (line) => lines.push(line) }, lines };
}
const refusedCommentRoute = (number) => ({
  method: "POST",
  path: `/issues/${number}/comments`,
  status: 403,
  body: { message: "Resource not accessible by integration" },
});

test("a conflict wake that fails to post says so, with GitHub's status and message", async () => {
  const pr = makePr(31, { mergeable: false, mergeable_state: "dirty" });
  const { logger, lines } = capture();
  const { results } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), emptyCommentsRoute, refusedCommentRoute(31)],
    updateToken: "pat",
    logger,
  });
  assert.deepEqual(results, [
    { number: 31, verdict: "conflict", action: "comment-failed", status: 403 },
  ]);
  const warning = lines.find((line) => line.startsWith("::warning::"));
  assert.ok(warning, "a failed wake must be a workflow warning, not a plain log line");
  assert.match(warning, /#31: CONFLICTS with main/);
  assert.match(warning, /HTTP 403: Resource not accessible by integration/);
});

test("a wake that posts is a plain log line, never a warning", async () => {
  const pr = makePr(34, { mergeable: false, mergeable_state: "dirty" });
  const { logger, lines } = capture();
  const { results } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), emptyCommentsRoute],
    logger,
  });
  assert.equal(results[0].action, "commented");
  assert.ok(lines.some((line) => /#34: CONFLICTS with main — wake comment posted/.test(line)));
  assert.ok(!lines.some((line) => line.startsWith("::")), "a warning on success buries real failures");
});

test("an HTML error page is cut to one escaped line, so the warning keeps its tail", async () => {
  const pr = makePr(35, { mergeable: false, mergeable_state: "dirty" });
  const { logger, lines } = capture();
  await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      emptyCommentsRoute,
      {
        method: "POST",
        path: "/issues/35/comments",
        status: 502,
        body: "<!DOCTYPE html>\n<html><body>Unicorn! 100% down</body></html>",
      },
    ],
    logger,
  });
  const warning = lines.find((line) => line.startsWith("::warning::"));
  assert.ok(warning);
  assert.ok(!/[\r\n]/.test(warning), "a raw newline ends the annotation early");
  assert.match(warning, /HTTP 502: <!DOCTYPE html>\); the session watching this PR was not woken$/);
  assert.ok(!warning.includes("Unicorn"));
});

test("update-branch goes through the app token, and nothing else does", async () => {
  // GITHUB_TOKEN holds pull-requests: write for the wake comments, so the
  // permission no longer refuses update-branch through it; only the code
  // keeps that push (which would trigger no CI) on the app token.
  const behind = makePr(36);
  const conflicted = makePr(37, { mergeable: false, mergeable_state: "dirty" });
  const { calls } = await sweep({
    routes: [
      listRoute([behind, conflicted]),
      detailRoute(behind),
      detailRoute(conflicted),
      compareRoute(behind.head.sha, 1),
      { method: "PUT", path: "/pulls/36/update-branch", status: 202, body: {} },
      emptyCommentsRoute,
    ],
    updateToken: "pat",
  });
  const updates = calls.filter((c) => c.url.includes("/update-branch"));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].token, "pat");
  const others = calls.filter((c) => !c.url.includes("/update-branch"));
  assert.ok(others.length > 0);
  assert.ok(
    others.every((c) => c.token === "t"),
    "reads, wake comments and the alert go through GITHUB_TOKEN, never the app token",
  );
});

// #3783: a record PR conflicts with every other record PR that merges first,
// and its merge is mechanical, so the sweep merges it instead of waking anyone.
const REGISTRY = "apps/mobile/store/shipped-builds.json";
const registryText = (builds) => `${JSON.stringify({ builds }, null, 2)}\n`;
const registryEntry = (version, build) => ({
  platform: "ios",
  version,
  build,
  sha: "e".repeat(40),
  recorded: "2026-11-06",
});
function registryConflictRoutes(pr, files, { listed = true } = {}) {
  const at = (sha, builds) => ({
    method: "GET",
    path: `/contents/${REGISTRY}?ref=${sha}`,
    body: { content: Buffer.from(registryText(builds)).toString("base64") },
  });
  const mergeBase = "f".repeat(40);
  return [
    ...(listed ? [listRoute([pr]), detailRoute(pr)] : []),
    {
      method: "GET",
      path: `/compare/${BASE_SHA}...${pr.head.sha}`,
      body: { merge_base_commit: { sha: mergeBase }, files },
    },
    at(mergeBase, [registryEntry("0.10.0", "10")]),
    at(pr.head.sha, [registryEntry("0.10.0", "10"), registryEntry("0.10.0", "11")]),
    at(BASE_SHA, [registryEntry("0.10.0", "10"), registryEntry("0.10.1", "12")]),
    { method: "GET", path: `/git/commits/${BASE_SHA}`, body: { tree: { sha: "basetree" } } },
    { method: "POST", path: "/git/trees", body: { sha: "newtree" } },
    { method: "POST", path: "/git/commits", body: { sha: "9".repeat(40) } },
    { method: "PATCH", path: "/git/refs/heads/", body: {} },
    emptyCommentsRoute,
  ];
}

test("a conflict only in the shipped-builds registry is merged through the app token, with no wake", async () => {
  const pr = makePr(38, { mergeable: false, mergeable_state: "dirty" });
  const { logger, lines } = capture();
  const { results, calls } = await sweep({
    routes: registryConflictRoutes(pr, [{ filename: REGISTRY }]),
    updateToken: "pat",
    logger,
  });
  assert.deepEqual(results, [{ number: 38, verdict: "conflict", action: "registry-merged" }]);
  const ref = calls.find((c) => c.method === "PATCH");
  assert.ok(ref.url.endsWith(`/git/refs/heads/${pr.head.ref}`));
  assert.deepEqual(JSON.parse(ref.body), { sha: "9".repeat(40), force: false });
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.includes("/comments")), "no wake comment");
  assert.ok(!calls.some((c) => c.url.includes("/update-branch")));
  // The app token only writes; every read stays on GITHUB_TOKEN.
  for (const c of calls) assert.equal(c.token, c.method === "GET" || c.url.includes("/comments") ? "t" : "pat", `${c.method} ${c.url}`);
  assert.ok(lines.some((l) => /#38: conflicts only in apps\/mobile\/store\/shipped-builds\.json, resolved with merge commit 999999999999/.test(l)));
});

test("a conflict that touches any other file still gets the wake comment, and nothing is pushed", async () => {
  const pr = makePr(39, { mergeable: false, mergeable_state: "dirty" });
  const { logger, lines } = capture();
  const { results, calls } = await sweep({
    routes: [
      ...registryConflictRoutes(pr, [{ filename: REGISTRY }, { filename: "apps/api/src/main.ts" }]),
      { method: "POST", path: "/issues/39/comments", status: 201, body: { id: 1 } },
    ],
    updateToken: "pat",
    logger,
  });
  assert.equal(results[0].verdict, "conflict");
  assert.notEqual(results[0].action, "updated");
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/issues/39/comments")));
  assert.ok(!calls.some((c) => ["PATCH"].includes(c.method) || c.url.includes("/git/")));
  assert.ok(lines.some((l) => /#39: not a registry-only conflict: the PR changes more than/.test(l)));
});

test("without the app token a registry-only conflict gets the wake, and nothing touches git", async () => {
  // A push through GITHUB_TOKEN starts no CI, so the merge must never fall back to it.
  const pr = makePr(42, { mergeable: false, mergeable_state: "dirty" });
  const { results, calls } = await sweep({
    routes: [
      ...registryConflictRoutes(pr, [{ filename: REGISTRY }]),
      { method: "POST", path: "/issues/42/comments", status: 201, body: { id: 1 } },
      { method: "GET", path: "/issues?state=all", body: [] },
    ],
  });
  assert.equal(results[0].verdict, "conflict");
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/issues/42/comments")));
  assert.ok(!calls.some((c) => c.url.includes("/git/") || c.url.includes(`/compare/${BASE_SHA}`)));
});

test("a refused registry merge falls back to the wake comment", async () => {
  const pr = makePr(43, { mergeable: false, mergeable_state: "dirty" });
  const routes = registryConflictRoutes(pr, [{ filename: REGISTRY }]).map((r) =>
    r.method === "PATCH" ? { ...r, status: 403, body: { message: "Resource not accessible by integration" } } : r,
  );
  const { logger, lines } = capture();
  const { results, calls } = await sweep({
    routes: [...routes, { method: "POST", path: "/issues/43/comments", status: 201, body: { id: 1 } }],
    updateToken: "pat",
    logger,
  });
  assert.notEqual(results[0].action, "registry-merged");
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/issues/43/comments")));
  assert.ok(lines.some((l) => /#43: registry merge refused, so it gets the wake: PATCH .* \(HTTP 403: Resource not accessible by integration\)/.test(l)));
});

// 2026-11-14: a conflict where both sides only added lines is merged keep-both
// (resolve-added-lines-conflict.mjs), with no wake.
function addedLinesStub({ plan, push = { resolved: true, sha: "8".repeat(40) } }) {
  const seen = { plans: [], pushes: [] };
  return {
    seen,
    addedLines: {
      plan: async (args) => (seen.plans.push(args), plan),
      push: (args) => (seen.pushes.push(args), push),
    },
  };
}
const conflictRoutes = (pr) => [
  listRoute([pr]),
  detailRoute(pr),
  // Not registry-only, so the registry plan stops at the compare.
  { method: "GET", path: `/compare/${BASE_SHA}...${pr.head.sha}`, body: { merge_base_commit: { sha: "f".repeat(40) }, files: [{ filename: "a.ts" }] } },
  emptyCommentsRoute,
];

test("a conflict where both sides only added lines is merged keep-both through the app token, with no wake", async () => {
  const pr = makePr(50, { mergeable: false, mergeable_state: "dirty" });
  const { addedLines, seen } = addedLinesStub({
    plan: { ok: true, commit: "8".repeat(40), branch: pr.head.ref, headSha: pr.head.sha, files: ["a.ts"], hunks: 2 },
  });
  const { logger, lines } = capture();
  const { results, calls } = await sweep({ routes: conflictRoutes(pr), updateToken: "pat", logger, addedLines, requireUpToDate: false });
  assert.deepEqual(results, [{ number: 50, verdict: "conflict", action: "added-lines-merged" }]);
  assert.equal(seen.plans[0].token, "t", "the plan reads through GITHUB_TOKEN");
  assert.equal(seen.pushes[0].pushToken, "pat", "only the app token's push starts CI");
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.includes("/comments")), "no wake comment");
  assert.ok(lines.some((l) => /#50: both sides only added lines in a\.ts — kept both \(2 hunk\(s\)\), merge commit 888888888888/.test(l)));
});

test("a real conflict left gets the wake, and nothing is pushed", async () => {
  const pr = makePr(51, { mergeable: false, mergeable_state: "dirty" });
  const { addedLines, seen } = addedLinesStub({
    plan: { ok: false, reason: "a.ts has a hunk where a side changed or removed existing lines" },
  });
  const { logger, lines } = capture();
  const { results, calls } = await sweep({
    routes: [...conflictRoutes(pr), { method: "POST", path: "/issues/51/comments", status: 201, body: { id: 1 } }],
    updateToken: "pat",
    logger,
    addedLines,
    requireUpToDate: false,
  });
  assert.equal(results[0].verdict, "conflict");
  assert.equal(seen.pushes.length, 0);
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/issues/51/comments")));
  assert.ok(lines.some((l) => /#51: conflict left for a person: a\.ts has a hunk where a side changed/.test(l)));
});

test("a refused keep-both push falls back to the wake and marks the sweep untested", async () => {
  const pr = makePr(52, { mergeable: false, mergeable_state: "dirty" });
  const { addedLines } = addedLinesStub({
    plan: { ok: true, commit: "8".repeat(40), branch: pr.head.ref, headSha: pr.head.sha, files: ["a.ts"], hunks: 1 },
    push: { resolved: false, reason: "git push failed: ! [rejected] (fetch first)" },
  });
  const { results, calls } = await sweep({
    routes: [...conflictRoutes(pr), { method: "POST", path: "/issues/52/comments", status: 201, body: { id: 1 } }],
    updateToken: "pat",
    addedLines,
    requireUpToDate: false,
  });
  assert.equal(results[0].addedLinesRefused, true);
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/issues/52/comments")));
});

test("without the app token the keep-both resolver is never asked", async () => {
  const pr = makePr(53, { mergeable: false, mergeable_state: "dirty" });
  const { addedLines, seen } = addedLinesStub({ plan: { ok: true } });
  await sweep({
    routes: [...conflictRoutes(pr), { method: "POST", path: "/issues/53/comments", status: 201, body: { id: 1 } }],
    addedLines,
    requireUpToDate: false,
  });
  assert.equal(seen.plans.length, 0);
});

test("a behind wake that fails to post says so too", async () => {
  const pr = makePr(32, {
    head: {
      ref: "feature",
      sha: "32".padStart(40, "0"),
      repo: { full_name: "someone-else/Frapp" },
    },
  });
  const { logger, lines } = capture();
  const { results } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      emptyCommentsRoute,
      refusedCommentRoute(32),
    ],
    updateToken: "pat",
    logger,
  });
  assert.deepEqual(results, [
    { number: 32, verdict: "behind", action: "comment-failed", status: 403 },
  ]);
  assert.ok(lines.some((line) => /^::warning::.*#32: behind by 1.*FAILED \(HTTP 403/.test(line)));
});

test("a wake that gets no response names that instead of a status", async () => {
  const pr = makePr(33, { mergeable: false, mergeable_state: "dirty" });
  const { logger, lines } = capture();
  const { results } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), emptyCommentsRoute],
    logger,
    fetchWrapper: (fetchImpl) => (url, init) => {
      if (init?.method === "POST" && url.includes("/issues/33/comments")) {
        return Promise.reject(new Error("ECONNRESET"));
      }
      return fetchImpl(url, init);
    },
  });
  assert.equal(results[0].action, "comment-failed");
  assert.ok(lines.some((line) => /^::warning::.*#33.*FAILED \(no response/.test(line)));
});

// ── Sweep: behind PR, with and without the PAT ──────────────────────────────

test("behind + PAT: updates via update-branch with expected_head_sha, no comment", async () => {
  const pr = makePr(12);
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 2),
      { method: "PUT", path: "/pulls/12/update-branch", status: 202, body: {} },
      emptyCommentsRoute,
    ],
    updateToken: "pat",
  });
  assert.deepEqual(results, [{ number: 12, verdict: "behind", action: "updated" }]);
  const update = calls.find((c) => c.method === "PUT" && c.url.includes("/update-branch"));
  assert.ok(update, "update-branch must be called");
  assert.equal(JSON.parse(update.body).expected_head_sha, pr.head.sha);
  assert.ok(
    !calls.some((c) => c.method === "POST" && c.url.includes("/comments")),
    "a successful auto-update needs no wake comment",
  );
});

const filedIssues = (calls) =>
  calls.filter((c) => c.method === "POST" && /\/issues$/.test(c.url.split("?")[0]));

test("no app token: the PR still gets its wake, and the DIAGNOSIS goes to one issue", async () => {
  const pr = makePr(13);
  const { results, calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), compareRoute(pr.head.sha, 1), emptyCommentsRoute],
    updateToken: null,
  });
  assert.equal(results[0].number, 13);
  assert.equal(results[0].verdict, "behind");
  assert.equal(results[0].action, "commented");
  assert.ok(!calls.some((c) => c.url.includes("/update-branch")));

  // The wake is what unblocks THIS PR — never suppressed.
  const posted = calls.find((c) => c.method === "POST" && c.url.includes("/issues/13/comments"));
  assert.ok(posted, "the watching session still gets told the base moved");
  const body = JSON.parse(posted.body).body;
  assert.match(body, /git merge origin\/main/);
  // ...but the repo-level cause is NOT restated on a PR whose reader cannot fix it.
  assert.ok(!body.includes("PR_BASE_SYNC_APP_CLIENT_ID"));

  const filed = filedIssues(calls);
  assert.equal(filed.length, 1);
  assert.equal(JSON.parse(filed[0].body).title, ALERT.title);
  assert.match(JSON.parse(filed[0].body).body, /PR_BASE_SYNC_APP_CLIENT_ID/);
  assert.match(JSON.parse(filed[0].body).body, /Contents: Read and write/);
});

test("no app token, twenty behind PRs: twenty wakes but exactly one alert issue", async () => {
  const prs = Array.from({ length: 20 }, (_, i) => makePr(100 + i));
  const { calls } = await sweep({
    routes: [
      listRoute(prs),
      ...prs.map(detailRoute),
      ...prs.map((pr) => compareRoute(pr.head.sha, 1)),
      emptyCommentsRoute,
      { method: "GET", path: "/issues?state=all", body: [] },
    ],
    updateToken: null,
  });
  assert.equal(filedIssues(calls).length, 1, "one alert for the sweep, not one per PR");
  assert.equal(
    calls.filter((c) => c.method === "GET" && c.url.includes("/issues?state=all")).length,
    1,
    "the open-alert check's read is handed to the raise, not repeated (#2333)",
  );
  assert.equal(
    calls.filter((c) => c.method === "POST" && c.url.includes("/comments")).length,
    20,
    "each PR keeps the wake that tells its own session what to do",
  );
});

test("an already-open alert is not re-commented on every merge to main", async () => {
  const pr = makePr(21);
  const { calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 900, state: "open", title: ALERT.title }],
      },
      emptyCommentsRoute,
    ],
    updateToken: null,
  });
  assert.equal(filedIssues(calls).length, 0, "no duplicate issue");
  assert.ok(
    !calls.some((c) => c.method === "POST" && c.url.includes("/issues/900/comments")),
    "an open alert says everything a fresh comment would; this fires on EVERY merge",
  );
});

test("a rejected app token names the token, and still wakes the PR", async () => {
  const pr = makePr(15);
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      {
        method: "PUT",
        path: "/pulls/15/update-branch",
        status: 403,
        body: { message: "Resource not accessible by integration" },
      },
      emptyCommentsRoute,
    ],
    updateToken: "expired-app-token",
  });
  assert.equal(results[0].action, "commented");
  assert.match(results[0].blockedDetail, /rejected/);
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/issues/15/comments")));
  assert.equal(filedIssues(calls).length, 1);
});

test("a rate-limit 403 is NOT a dead token: skip fail-safe, no alert, no comment", async () => {
  const pr = makePr(22);
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      {
        method: "PUT",
        path: "/pulls/22/update-branch",
        status: 403,
        body: { message: "You have exceeded a secondary rate limit. Please wait a few minutes." },
      },
      emptyCommentsRoute,
    ],
    updateToken: "healthy-app-token",
  });
  assert.deepEqual(results, [{ number: 22, verdict: "unknown", action: "skipped" }]);
  assert.equal(
    filedIssues(calls).length,
    0,
    "accusing a healthy credential is worse than waiting for the next sweep",
  );
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.includes("/comments")));
});

test("a close that leaves a duplicate alert open is surfaced, not dropped", async () => {
  // resolveAlert reports a partial close as "failed" with what did close; a
  // sweep that logged only "closed" would hide the one left open.
  const openAlerts = [
    { number: 900, state: "open", title: ALERT.title },
    { number: 901, state: "open", title: ALERT.title },
  ];
  const lines = [];
  const pr = makePr(16);
  await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      { method: "PUT", path: "/pulls/16/update-branch", status: 202, body: {} },
      { method: "GET", path: "/issues?state=all", body: openAlerts },
      { method: "PATCH", path: "/issues/901", status: 502, body: {} },
      { method: "PATCH", path: "/issues/900", status: 200, body: {} },
      emptyCommentsRoute,
    ],
    updateToken: "app-token",
    logger: { log: (line) => lines.push(line) },
  });
  const warning = lines.find((line) => line.startsWith("::warning::[pr-base-sync]"));
  assert.ok(warning, "a failed close must reach the run log");
  assert.match(warning, /could not be closed \(closed #900\)/);
});

test("a successful update whose alert lookup fails warns 'could not be read', never 'still open'", async () => {
  // resolveAlert reports a failed lookup as "unread" (#2627). The sweep keeps
  // going and the next merge looks again; the warning must not claim to know
  // whether an alert is open.
  const lines = [];
  const pr = makePr(17);
  const { calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      { method: "PUT", path: "/pulls/17/update-branch", status: 202, body: {} },
      { method: "GET", path: "/issues?state=all", status: 502, body: {} },
      emptyCommentsRoute,
    ],
    updateToken: "app-token",
    logger: { log: (line) => lines.push(line) },
  });
  const warning = lines.find((line) => line.startsWith("::warning::[pr-base-sync]"));
  assert.match(warning ?? "", /alert issues could not be read, so none was closed/);
  assert.ok(!lines.some((line) => /still open|could not be closed/.test(line)));
  assert.ok(!calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/")));
});

test("a successful update closes an open alert; a quiet sweep does not", async () => {
  const openAlert = [{ number: 900, state: "open", title: ALERT.title }];
  const alertLookupRoute = { method: "GET", path: "/issues?state=all", body: openAlert };

  const pr = makePr(16);
  const { calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      { method: "PUT", path: "/pulls/16/update-branch", status: 202, body: {} },
      alertLookupRoute,
      { method: "PATCH", path: "/issues/900", status: 200, body: {} },
      emptyCommentsRoute,
    ],
    updateToken: "app-token",
  });
  const closed = calls.find((c) => c.method === "PATCH" && c.url.includes("/issues/900"));
  assert.ok(closed, "proof that auto-update works closes the alert");
  assert.equal(JSON.parse(closed.body).state, "closed");

  // A quiet sweep WITH a working token also closes it: this repo merges about
  // one PR at a time, so an alert gated on a same-sweep update would outlive
  // the fix by weeks. The closing comment must not overstate what it saw.
  const inSync = makePr(17);
  const quiet = await sweep({
    routes: [
      listRoute([inSync]),
      detailRoute(inSync),
      compareRoute(inSync.head.sha, 0),
      alertLookupRoute,
      { method: "PATCH", path: "/issues/900", status: 200, body: {} },
      emptyCommentsRoute,
    ],
    updateToken: "app-token",
  });
  const quietClose = quiet.calls.find(
    (c) => c.method === "PATCH" && c.url.includes("/issues/900"),
  );
  assert.ok(quietClose, "the cause is gone, so the alert must not outlive it");
  const recovery = quiet.calls.find(
    (c) => c.method === "POST" && c.url.includes("/issues/900/comments"),
  );
  assert.match(JSON.parse(recovery.body).body, /absence of the fault/);

  // But a sweep with NO token proves nothing and must leave it open.
  const untokened = await sweep({
    routes: [
      listRoute([inSync]),
      detailRoute(inSync),
      compareRoute(inSync.head.sha, 0),
      alertLookupRoute,
      emptyCommentsRoute,
    ],
    updateToken: null,
  });
  assert.ok(
    !untokened.calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/900")),
    "an untokened sweep with nothing behind is the one case that proves nothing",
  );
});

test("behind + PAT but update-branch fails: falls back to the wake comment", async () => {
  const pr = makePr(14);
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      {
        method: "PUT",
        path: "/pulls/14/update-branch",
        status: 422,
        body: { message: "expected head sha didn't match" },
      },
      emptyCommentsRoute,
    ],
    updateToken: "pat",
  });
  assert.deepEqual(results, [{ number: 14, verdict: "behind", action: "commented" }]);
  const posted = calls.find((c) => c.method === "POST" && c.url.includes("/issues/14/comments"));
  assert.match(JSON.parse(posted.body).body, /update-branch call failed/);
});

test("behind fork head: wake comment, never an update attempt even with the PAT", async () => {
  const pr = makePr(15, {
    head: {
      ref: "feature",
      sha: "15".padStart(40, "0"),
      repo: { full_name: "someone-else/Frapp" },
    },
  });
  const { results, calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), compareRoute(pr.head.sha, 1), emptyCommentsRoute],
    updateToken: "pat",
  });
  assert.deepEqual(results, [{ number: 15, verdict: "behind", action: "commented" }]);
  assert.ok(!calls.some((c) => c.url.includes("/update-branch")));
  const posted = calls.find((c) => c.method === "POST" && c.url.includes("/issues/15/comments"));
  assert.match(JSON.parse(posted.body).body, /fork/);
});

// ── Sweep: in-sync and unknown PRs ──────────────────────────────────────────

test("up-to-date PR stays silent and clears its stale wake comment", async () => {
  const pr = makePr(16);
  const stale = [{ id: 901, body: `${BASE_SYNC_MARKER}\nold wake` }];
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 0),
      { method: "GET", path: "/comments", body: stale },
      { method: "DELETE", path: "/issues/comments/901", body: {} },
    ],
    updateToken: "pat",
  });
  assert.deepEqual(results, [{ number: 16, verdict: "current", action: "none" }]);
  assert.ok(
    calls.some((c) => c.method === "DELETE" && c.url.includes("/issues/comments/901")),
    "stale wake comment must be cleared once the PR is back in sync",
  );
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.includes("/comments")));
});

test("mergeability that never resolves is skipped — no update, no comment", async () => {
  const pr = makePr(17, { mergeable: null });
  const { results, calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr)],
    updateToken: "pat",
  });
  assert.deepEqual(results, [{ number: 17, verdict: "unknown", action: "skipped" }]);
  assert.ok(!calls.some((c) => c.url.includes("/update-branch")));
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.includes("/comments")));
});

test("compare failure is skipped fail-safe, not treated as in-sync", async () => {
  const pr = makePr(18);
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      { method: "GET", path: "/compare/", status: 500, body: {} },
    ],
    updateToken: "pat",
  });
  assert.deepEqual(results, [{ number: 18, verdict: "unknown", action: "skipped" }]);
  assert.ok(!calls.some((c) => c.method === "DELETE"), "must not clear comments on unknown state");
});

// ── Sweep bounds ────────────────────────────────────────────────────────────

test("caps the sweep at MAX_PRS and logs the dropped remainder", async () => {
  const prs = Array.from({ length: MAX_PRS + 2 }, (_, i) => makePr(100 + i, { mergeable: null }));
  const logged = [];
  const { fetchImpl } = makeFetchMock([
    listRoute(prs),
    // every detail fetch returns mergeable:null → each processed PR is skipped
    { method: "GET", path: "/pulls/1", body: { mergeable: null } },
  ]);
  const results = await processBaseMove({
    requireUpToDate: true,
    token: "t",
    updateToken: null,
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl,
    sleep: makeSleep().sleep,
    logger: { log: (line) => logged.push(line) },
  });
  assert.equal(results.length, MAX_PRS);
  assert.ok(
    logged.some((line) => line.includes(`deferring 2`)),
    "the deferred remainder must be logged, never silent",
  );
});

test("lists PRs least-recently-updated first so the cap rotates instead of starving", async () => {
  const pr = makePr(19);
  const { calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), compareRoute(pr.head.sha, 0), emptyCommentsRoute],
  });
  const list = calls.find((c) => c.url.includes("/pulls?"));
  assert.match(list.url, /sort=updated/);
  assert.match(list.url, /direction=asc/);
});

test("a failed PR list does nothing and reports nothing done", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/pulls?base=", status: 500, body: {} },
  ]);
  const results = await processBaseMove({
    requireUpToDate: true,
    token: "t",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl,
    sleep: makeSleep().sleep,
    logger: quiet,
  });
  assert.deepEqual(results, []);
  assert.equal(calls.length, 1, "no per-PR calls after a failed list");
});

// ── Resilience and misclassification recovery ───────────────────────────────

test("a network-level rejection on one PR costs that PR, not the sweep", async () => {
  // ghRequest converts fetch rejections into ok:false; the per-PR belt catches
  // anything else. Either way #21 is skipped fail-safe and #22 still processes.
  const pr21 = makePr(21);
  const pr22 = makePr(22);
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr21, pr22]),
      detailRoute(pr22),
      compareRoute(pr22.head.sha, 0),
      emptyCommentsRoute,
    ],
    fetchWrapper: (fetchImpl) => (url, init) => {
      if (url.includes("/pulls/21")) return Promise.reject(new Error("ECONNRESET"));
      return fetchImpl(url, init);
    },
  });
  assert.deepEqual(results, [
    { number: 21, verdict: "unknown", action: "skipped" },
    { number: 22, verdict: "current", action: "none" },
  ]);
  assert.ok(calls.some((c) => c.url.includes("/pulls/22")), "#22 must still be examined");
});

test("update-branch failing with a conflict message posts the CONFLICT wake, not the behind one", async () => {
  // The stale-`mergeable` race: cached mergeable:true from the previous base, but
  // the update reveals the truth. The agent must get conflict-resolution guidance.
  const pr = makePr(23);
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 1),
      {
        method: "PUT",
        path: "/pulls/23/update-branch",
        status: 422,
        body: { message: "merge conflict between base and head" },
      },
      emptyCommentsRoute,
    ],
    updateToken: "pat",
  });
  assert.deepEqual(results, [{ number: 23, verdict: "conflict", action: "commented" }]);
  const posted = calls.find((c) => c.method === "POST" && c.url.includes("/issues/23/comments"));
  assert.match(JSON.parse(posted.body).body, /merge conflicts/);
});

test("a quote-reply embedding the marker mid-body is never treated as a wake comment", async () => {
  // GitHub's quote-reply copies raw markdown including the invisible marker; the
  // scan must match leading markers only, or the sweep deletes the human's reply.
  const pr = makePr(24);
  const quoted = { id: 950, body: `> ${BASE_SYNC_MARKER}\n> old wake\n\nmerged main, resolved.` };
  const mine = { id: 951, body: `${BASE_SYNC_MARKER}\nold wake` };
  const { calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      compareRoute(pr.head.sha, 0),
      { method: "GET", path: "/comments", body: [quoted, mine] },
      { method: "DELETE", path: "/issues/comments/951", body: {} },
    ],
  });
  assert.ok(
    calls.some((c) => c.method === "DELETE" && c.url.includes("/issues/comments/951")),
    "the sweep's own stale comment is cleared",
  );
  assert.ok(
    !calls.some((c) => c.method === "DELETE" && c.url.includes("/issues/comments/950")),
    "the quote-reply must survive",
  );
});

// ── A stalled update-branch API (#2973) ─────────────────────────────────────

/** A fetch that never answers update-branch, until its deadline aborts it. */
function stallUpdateBranch(fetchImpl, { except = () => false } = {}) {
  return (url, init) => {
    if (!url.includes("/update-branch") || except(url)) return fetchImpl(url, init);
    return new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal.reason));
    });
  };
}

// A deadline that stops firing would hang these tests rather than fail them:
// node:test has no per-test timeout of its own.
const STALL_TEST = { timeout: 10_000 };

test("a stalled update-branch API stops being called, and the sweep still files its alert", STALL_TEST, async () => {
  const prs = Array.from({ length: MAX_PRS }, (_, i) => makePr(300 + i));
  const { fetchImpl, calls } = makeFetchMock([
    listRoute(prs),
    ...prs.map(detailRoute),
    ...prs.map((pr) => compareRoute(pr.head.sha, 1)),
    emptyCommentsRoute,
    { method: "GET", path: "/issues?state=all", body: [] },
  ]);
  const results = await processBaseMove({
    requireUpToDate: true,
    token: "t",
    updateToken: "app",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl: stallUpdateBranch(fetchImpl),
    sleep: makeSleep().sleep,
    logger: quiet,
    // Stands in for the two-minute write ceiling. What the sweep pays is this
    // times the number of calls, which the next test pins.
    updateBranchTimeoutMs: 50,
  });

  // Every PR is behind and blocked, none updated, and none skipped.
  assert.equal(results.length, MAX_PRS);
  assert.ok(results.every((r) => r.verdict === "behind" && r.action === "commented"));
  assert.ok(results.every((r) => /update-branch API is failing/.test(r.blockedDetail)));
  assert.match(
    results[0].blockedDetail,
    /\(no response: .*timeout.*\)/i,
    "the alert names the transport failure, not a bare HTTP 0",
  );
  assert.equal(filedIssues(calls).length, 1, "the repo-level alert is reached and filed");
  assert.equal(
    calls.filter((c) => c.method === "POST" && c.url.includes("/comments")).length,
    MAX_PRS,
    "every behind PR still gets its wake",
  );
});

test("a stalled update-branch is attempted only until the stop threshold", STALL_TEST, async () => {
  const prs = Array.from({ length: 5 }, (_, i) => makePr(320 + i));
  const { fetchImpl } = makeFetchMock([
    listRoute(prs),
    ...prs.map(detailRoute),
    ...prs.map((pr) => compareRoute(pr.head.sha, 1)),
    emptyCommentsRoute,
    { method: "GET", path: "/issues?state=all", body: [] },
  ]);
  const attempted = [];
  const stalled = stallUpdateBranch(fetchImpl);
  await processBaseMove({
    requireUpToDate: true,
    token: "t",
    updateToken: "app",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl: (url, init) => {
      if (url.includes("/update-branch")) attempted.push(url);
      return stalled(url, init);
    },
    sleep: makeSleep().sleep,
    logger: quiet,
    updateBranchTimeoutMs: 20,
  });
  assert.equal(attempted.length, UPDATE_BRANCH_STALLS_BEFORE_STOP);
});

test("one stalled update among working ones stops nothing and files no alert", STALL_TEST, async () => {
  const prs = Array.from({ length: 4 }, (_, i) => makePr(340 + i));
  const { fetchImpl, calls } = makeFetchMock([
    listRoute(prs),
    ...prs.map(detailRoute),
    ...prs.map((pr) => compareRoute(pr.head.sha, 1)),
    ...prs.map((pr) => ({
      method: "PUT",
      path: `/pulls/${pr.number}/update-branch`,
      status: 202,
      body: {},
    })),
    emptyCommentsRoute,
    { method: "GET", path: "/issues?state=all", body: [] },
  ]);
  const results = await processBaseMove({
    requireUpToDate: true,
    token: "t",
    updateToken: "app",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    // Only the first PR's update stalls.
    fetchImpl: stallUpdateBranch(fetchImpl, { except: (url) => !url.includes("/pulls/340/") }),
    sleep: makeSleep().sleep,
    logger: quiet,
    updateBranchTimeoutMs: 20,
  });
  assert.equal(results[0].action, "commented");
  assert.deepEqual(
    results.slice(1).map((r) => r.action),
    ["updated", "updated", "updated"],
  );
  assert.equal(filedIssues(calls).length, 0, "a success outranks the one stalled sibling");
});

test("a stall, an update, then a stall does not stop the sweep: stalls count in a row", STALL_TEST, async () => {
  const prs = Array.from({ length: 5 }, (_, i) => makePr(350 + i));
  const { fetchImpl } = makeFetchMock([
    listRoute(prs),
    ...prs.map(detailRoute),
    ...prs.map((pr) => compareRoute(pr.head.sha, 1)),
    ...prs.map((pr) => ({
      method: "PUT",
      path: `/pulls/${pr.number}/update-branch`,
      status: 202,
      body: {},
    })),
    emptyCommentsRoute,
    { method: "GET", path: "/issues?state=all", body: [] },
  ]);
  const attempted = [];
  // PRs 350 and 352 stall; 351, 353 and 354 answer.
  const stalled = stallUpdateBranch(fetchImpl, {
    except: (url) => !/\/pulls\/35[02]\//.test(url),
  });
  const results = await processBaseMove({
    requireUpToDate: true,
    token: "t",
    updateToken: "app",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl: (url, init) => {
      if (url.includes("/update-branch")) attempted.push(url);
      return stalled(url, init);
    },
    sleep: makeSleep().sleep,
    logger: quiet,
    updateBranchTimeoutMs: 20,
  });
  assert.equal(attempted.length, 5, "every PR is tried");
  assert.deepEqual(
    results.map((r) => r.action),
    ["commented", "updated", "commented", "updated", "updated"],
  );
});

test("an update-branch that fails fast without an answer does not stop the sweep", async () => {
  // A reset or a DNS failure is a transport failure too, but it costs nothing,
  // so it is no reason to stop trying the PRs after it.
  const prs = Array.from({ length: 4 }, (_, i) => makePr(370 + i));
  const { fetchImpl, calls } = makeFetchMock([
    listRoute(prs),
    ...prs.map(detailRoute),
    ...prs.map((pr) => compareRoute(pr.head.sha, 1)),
    ...prs.map((pr) => ({
      method: "PUT",
      path: `/pulls/${pr.number}/update-branch`,
      status: 202,
      body: {},
    })),
    emptyCommentsRoute,
    { method: "GET", path: "/issues?state=all", body: [] },
  ]);
  const reset = (url, init) =>
    /\/pulls\/37[01]\/update-branch/.test(url)
      ? Promise.reject(new TypeError("fetch failed", { cause: new Error("read ECONNRESET") }))
      : fetchImpl(url, init);
  const results = await processBaseMove({
    requireUpToDate: true,
    token: "t",
    updateToken: "app",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl: reset,
    sleep: makeSleep().sleep,
    logger: quiet,
  });
  assert.deepEqual(
    results.map((r) => r.action),
    ["commented", "commented", "updated", "updated"],
  );
  assert.match(results[0].blockedDetail, /no response: fetch failed: read ECONNRESET/);
  assert.equal(filedIssues(calls).length, 0, "the later updates outrank the resets");
});

test("a 5xx from update-branch is answered fast, so it does not stop the sweep's updates", async () => {
  const prs = Array.from({ length: 4 }, (_, i) => makePr(360 + i));
  const { calls } = await sweep({
    routes: [
      listRoute(prs),
      ...prs.map(detailRoute),
      ...prs.map((pr) => compareRoute(pr.head.sha, 1)),
      ...prs.map((pr) => ({
        method: "PUT",
        path: `/pulls/${pr.number}/update-branch`,
        status: 502,
        body: { message: "Bad Gateway" },
      })),
      emptyCommentsRoute,
      { method: "GET", path: "/issues?state=all", body: [] },
    ],
    updateToken: "app",
  });
  assert.equal(
    calls.filter((c) => c.method === "PUT").length,
    4,
    "every PR is still tried: a quick refusal costs the sweep nothing",
  );
});

// ── The auto-merge update slot (#3599) ──────────────────────────────────────

const AUTO = { auto_merge: { merge_method: "squash" } };
const autoPr = (number, overrides = {}) => makePr(number, { ...AUTO, ...overrides });
const minutesBefore = (minutes) => new Date(NOW - minutes * 60 * 1000).toISOString();

// Every required check reported green, with `overrides` replacing named entries.
function checkRuns(overrides = {}) {
  return ALL_REQUIRED_CHECKS.map((name) => ({
    name,
    status: "completed",
    conclusion: "success",
    started_at: "2026-11-06T19:00:00Z",
    completed_at: "2026-11-06T19:05:00Z",
    ...(overrides[name] ?? {}),
  }));
}
const running = (name) => checkRuns({ [name]: { status: "in_progress", conclusion: null } });
const checksRoute = (sha, runs, status = 200) => ({
  method: "GET",
  path: `/commits/${sha}/check-runs`,
  status,
  body: status === 200 ? { check_runs: runs } : { message: "Resource not accessible by integration" },
});
const suitesRoute = (sha, createdAt) => ({
  method: "GET",
  path: `/commits/${sha}/check-suites`,
  body: { check_suites: createdAt ? [{ created_at: createdAt }] : [] },
});
// Listed after the checks and suites routes: its path is a prefix of theirs.
const commitRoute = (sha, date) => ({
  method: "GET",
  path: `/commits/${sha}`,
  body: { commit: { committer: { date } } },
});
const updateRoute = (number, status = 202, body = {}) => ({
  method: "PUT",
  path: `/pulls/${number}/update-branch`,
  status,
  body,
});
const puts = (calls) =>
  calls.filter((c) => c.method === "PUT").map((c) => c.url.match(/pulls\/(\d+)/)[1]);
const commentPosts = (calls) =>
  calls.filter((c) => c.method === "POST" && c.url.includes("/comments"));
const byNumber = (results) => Object.fromEntries(results.map((r) => [r.number, r]));
const RACE_422 = { message: "expected head sha didn't match current head ref" };

function slotRoutes(
  prs,
  { behind = {}, runs = {}, updates = {}, committed = {}, pushed = {}, checksStatus = {} } = {},
) {
  return [
    listRoute(prs),
    ...prs.map(detailRoute),
    ...prs.map((pr) => compareRoute(pr.head.sha, behind[pr.number] ?? 1)),
    ...prs.map((pr) =>
      checksRoute(pr.head.sha, runs[pr.number] ?? checkRuns(), checksStatus[pr.number] ?? 200),
    ),
    ...prs.map((pr) => suitesRoute(pr.head.sha, pushed[pr.number])),
    ...prs.map((pr) => commitRoute(pr.head.sha, committed[pr.number] ?? "2026-11-06T19:00:00Z")),
    ...prs.map((pr) => updates[pr.number] ?? updateRoute(pr.number)),
    emptyCommentsRoute,
    { method: "GET", path: "/issues?state=all", body: [] },
  ];
}

test("several behind auto-merge PRs: only the lowest-numbered is updated, the rest are held in silence", async () => {
  // Listed in updated-asc order, not number order: the slot must not depend on it.
  const prs = [autoPr(63), autoPr(41), autoPr(52)];
  const { results, calls } = await sweep({ routes: slotRoutes(prs), updateToken: "app" });
  assert.deepEqual(puts(calls), ["41"], "one PR races CI at a time");
  const r = byNumber(results);
  assert.equal(r[41].action, "updated");
  assert.equal(r[52].action, "held");
  assert.equal(r[63].action, "held");
  assert.equal(r[52].holder, 41);
  assert.equal(
    commentPosts(calls).length,
    0,
    "a held PR gets no wake: 'merge main yourself' would restart the race",
  );
});

test("a held PR's stale wake from an earlier sweep is deleted", async () => {
  const routes = slotRoutes([autoPr(41), autoPr(52)]);
  routes.unshift(
    {
      method: "GET",
      path: "/issues/52/comments",
      body: [{ id: 9052, body: `${BASE_SYNC_MARKER}\n**Base-branch sync** — merge it yourself` }],
    },
    { method: "DELETE", path: "/issues/comments/9052", status: 204, body: {} },
  );
  const { calls } = await sweep({ routes, updateToken: "app" });
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.includes("/comments/9052")));
});

test("an up-to-date auto-merge PR with checks running keeps the slot, so nothing else is updated", async () => {
  const prs = [autoPr(41), autoPr(52), autoPr(63)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { behind: { 63: 0 }, runs: { 63: running("mobile-validate") } }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), [], "#63 is in flight; updating #41 would start a second racer");
  const r = byNumber(results);
  assert.equal(r[41].action, "held");
  assert.equal(r[41].holder, 63);
  assert.equal(r[63].verdict, "current");
});

test("a sweep whose behind PRs were all held does not close the token alert", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { calls } = await sweep({
    routes: slotRoutes(prs, { behind: { 52: 0 }, runs: { 52: running("api-tests") } }),
    updateToken: "app",
  });
  assert.ok(
    !calls.some((c) => c.url.includes("/issues?")),
    "no update-branch call was made, so 'hit no failure' would be vacuous",
  );
});

test("a just-updated holder with no check runs yet is still in flight", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { calls } = await sweep({
    routes: slotRoutes(prs, {
      behind: { 41: 0 },
      runs: { 41: [] },
      committed: { 41: minutesBefore(1) },
    }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(calls), [], "the cancelled old run's completion must not hand the slot on");
});

test("a head whose required checks never report stops holding the slot after the grace", async () => {
  const stale = new Date(NOW - CHECKS_START_GRACE_MS - 60_000).toISOString();
  const prs = [autoPr(41, { updated_at: minutesBefore(1) }), autoPr(52)];
  const { calls } = await sweep({
    routes: slotRoutes(prs, { behind: { 41: 0 }, runs: { 41: [] }, pushed: { 41: stale } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(
    puts(calls),
    ["52"],
    "measured from the push, so comments bumping updated_at don't extend it",
  );
});

test("the start grace runs from the push, not from an old commit date", async () => {
  // Committed an hour before it was pushed (a review gate between the two).
  const prs = [autoPr(41), autoPr(52)];
  const { calls } = await sweep({
    routes: slotRoutes(prs, {
      behind: { 41: 0 },
      runs: { 41: [] },
      pushed: { 41: minutesBefore(2) },
      committed: { 41: minutesBefore(60) },
    }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(calls), []);
});

test("an up-to-date PR whose checks or push time can't be read stays in flight", async () => {
  const unreadableChecks = await sweep({
    routes: slotRoutes([autoPr(41), autoPr(52)], { behind: { 41: 0 }, checksStatus: { 41: 502 } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(unreadableChecks.calls), [], "reading it as idle would start a second racer");

  const routes = slotRoutes([autoPr(41), autoPr(52)], { behind: { 41: 0 }, runs: { 41: [] } });
  routes.unshift({ method: "GET", path: `/commits/${autoPr(41).head.sha}/check-suites`, status: 502, body: {} });
  const unreadablePush = await sweep({ routes, updateToken: "app", mode: "checks" });
  assert.deepEqual(puts(unreadablePush.calls), []);
});

test("a just-updated holder whose mergeability hasn't resolved still holds the slot", async () => {
  const holder = autoPr(41, { mergeable: null });
  const prs = [holder, autoPr(52)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { behind: { 41: 0 }, runs: { 41: running("api-tests") } }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), []);
  assert.equal(byNumber(results)[52].holder, 41);
});

test("an auto-merge PR whose compare keeps failing holds the slot fail-safe and is never updated", async () => {
  // It may be the holder, up to date with CI running; reading it as idle would
  // start a second racer.
  const prs = [autoPr(41), autoPr(52)];
  const routes = slotRoutes(prs);
  routes.unshift({
    method: "GET",
    path: `/compare/${BASE_REF}...${autoPr(52).head.sha}`,
    body: { message: "oops" },
  });
  const { results, calls } = await sweep({ routes, updateToken: "app" });
  assert.deepEqual(puts(calls), []);
  assert.equal(byNumber(results)[52].action, "skipped");
  assert.equal(byNumber(results)[41].holder, 52);
});

test("up-to-date auto-merge PRs are reused in the per-PR pass, not read and compared again", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { behind: { 41: 0, 52: 0 }, runs: { 41: running("api-tests") } }),
    updateToken: "app",
  });
  assert.ok(!calls.some((c) => /\/pulls\/(41|52)$/.test(c.url)), "no detail (mergeable) polling");
  assert.equal(calls.filter((c) => c.url.includes("/compare/")).length, 2, "one compare each");
  assert.equal(byNumber(results)[52].verdict, "current");
});


test("a holder that just went green is left to merge; one green for long is not", async () => {
  const fresh = checkRuns({ "api-tests": { completed_at: minutesBefore(1) } });
  const greenNow = await sweep({
    routes: slotRoutes([autoPr(41), autoPr(52)], { behind: { 41: 0 }, runs: { 41: fresh } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(greenNow.calls), [], "auto-merge is about to act on #41");

  const longAgo = new Date(NOW - MERGE_GRACE_MS - 60_000).toISOString();
  const greenLong = await sweep({
    routes: slotRoutes([autoPr(41), autoPr(52)], {
      behind: { 41: 0 },
      runs: { 41: checkRuns({ "api-tests": { completed_at: longAgo } }) },
    }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(greenLong.calls), ["52"], "#41 waits on something other than CI");
});

test("a holder knocked behind by a manual merge keeps the slot over a lower-numbered PR", async () => {
  const prs = [autoPr(41), autoPr(63)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { runs: { 63: running("mobile-validate") } }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), ["63"]);
  assert.equal(byNumber(results)[41].action, "held");
});

test("when that holder can't be updated, the slot passes back to the lower-numbered PR", async () => {
  const prs = [autoPr(41), autoPr(63)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, {
      runs: { 63: running("mobile-validate") },
      updates: { 63: updateRoute(63, 403, { message: "Repository rule violations found" }) },
    }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), ["63", "41"]);
  assert.equal(byNumber(results)[41].action, "updated");
});

test("a red auto-merge PR is not queued: it is updated as before, and the slot goes to the next", async () => {
  const prs = [autoPr(41), autoPr(52), autoPr(63)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { runs: { 41: checkRuns({ "api-tests": { conclusion: "cancelled" } }) } }),
    updateToken: "app",
  });
  assert.deepEqual(
    puts(calls).sort(),
    ["41", "52"],
    "a fix on main must still reach a red PR; #52 holds the slot",
  );
  assert.equal(byNumber(results)[63].action, "held");
});

test("a skipped or neutral required check counts as a pass", async () => {
  // Path-gated required jobs conclude `skipped` on most PRs (ADR-15).
  const runs = checkRuns({
    "web-tests": { conclusion: "skipped" },
    "landing-fold": { conclusion: "neutral" },
  });
  const prs = [autoPr(41), autoPr(52)];
  const { calls } = await sweep({
    routes: slotRoutes(prs, { runs: { 41: runs, 52: runs } }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), ["41"], "both are queued, so only the holder is updated");
});

test("a PR whose checks can't be read waits behind a holder but never holds the slot", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const held = await sweep({
    routes: slotRoutes(prs, { checksStatus: { 41: 403 } }),
    updateToken: "app",
  });
  assert.deepEqual(puts(held.calls), ["52"], "#41 is not updated beside the holder");
  assert.equal(byNumber(held.results)[41].action, "held");

  const alone = await sweep({
    routes: slotRoutes([autoPr(41)], { checksStatus: { 41: 403 } }),
    updateToken: "app",
  });
  assert.deepEqual(puts(alone.calls), ["41"], "with no holder there is nothing to wait behind");
});

test("a holder whose update fails gets its wake, and the slot passes to the next PR", async () => {
  const prs = [autoPr(41), autoPr(52), autoPr(63)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, {
      updates: { 41: updateRoute(41, 403, { message: "Repository rule violations found" }) },
    }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), ["41", "52"]);
  const r = byNumber(results);
  assert.equal(r[41].action, "commented", "the failed holder still gets told what to do");
  assert.equal(r[52].action, "updated");
  assert.equal(r[63].action, "held");
  assert.equal(r[63].holder, 52);
});

test("when no PR can take the slot, every behind auto-merge PR gets its wake, as before", async () => {
  const prs = [autoPr(41), autoPr(52), autoPr(63)];
  const updates = Object.fromEntries(
    prs.map((pr) => [pr.number, updateRoute(pr.number, 502, { message: "Bad Gateway" })]),
  );
  const { results, calls } = await sweep({ routes: slotRoutes(prs, { updates }), updateToken: "app" });
  assert.deepEqual(puts(calls), ["41", "52", "63"]);
  assert.ok(results.every((r) => r.action === "commented"), "nobody is held behind nothing");
  assert.equal(commentPosts(calls).length, 3);
});

test("a head-moved 422 on the slot holder means another sweep got there: no wake, the slot stays", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { updates: { 41: updateRoute(41, 422, RACE_422) } }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), ["41"]);
  assert.equal(byNumber(results)[41].action, "raced");
  assert.equal(byNumber(results)[52].action, "held");
  assert.equal(commentPosts(calls).length, 0);
});

test("any other 422 is a failure: the holder gets its wake and the slot moves on", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, {
      updates: { 41: updateRoute(41, 422, { message: "Validation Failed" }) },
    }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), ["41", "52"]);
  assert.equal(byNumber(results)[41].action, "commented");
});

test("isHeadMoved reads the message, not just the status", () => {
  assert.equal(isHeadMoved({ status: 422, error: "HTTP 422: expected head sha didn't match current head ref" }), true);
  assert.equal(isHeadMoved({ status: 422, error: "HTTP 422: Validation Failed" }), false);
  assert.equal(isHeadMoved({ status: 409, error: "expected head sha" }), false);
});

test("PRs without auto-merge are still all updated beside a held queue", async () => {
  const prs = [autoPr(41), autoPr(52), makePr(74), makePr(85)];
  const { calls } = await sweep({ routes: slotRoutes(prs), updateToken: "app" });
  assert.deepEqual(puts(calls).sort(), ["41", "74", "85"]);
  assert.equal(
    calls.filter((c) => c.url.includes("/check-runs")).length,
    2,
    "checks are read for the two auto-merge PRs only",
  );
});

test("a fork PR with auto-merge is not queued: it keeps its fork wake and never holds the slot", async () => {
  const fork = autoPr(30, {
    head: { ref: "patch", sha: "f".repeat(40), repo: { full_name: "someone/Frapp" } },
  });
  const prs = [fork, autoPr(41)];
  const { results, calls } = await sweep({ routes: slotRoutes(prs), updateToken: "app" });
  assert.deepEqual(puts(calls), ["41"], "a fork head is never pushed to");
  assert.equal(byNumber(results)[30].action, "commented");
  assert.ok(!calls.some((c) => c.url.includes(`/commits/${"f".repeat(40)}/check-runs`)));
});

test("queued PRs share the MAX_PRS budget but always leave room for the rotation", async () => {
  const held = Array.from({ length: MAX_AUTO_MERGE_PRS }, (_, i) => autoPr(400 + i));
  const others = Array.from({ length: MAX_PRS }, (_, i) =>
    makePr(600 + i, { mergeable: false, mergeable_state: "dirty" }),
  );
  const { results } = await sweep({ routes: slotRoutes([...held, ...others]), updateToken: "app" });
  const processedOthers = results.filter((r) => r.number >= 600);
  assert.equal(processedOthers.length, MAX_PRS - MAX_AUTO_MERGE_PRS, "the job's budget doesn't grow");
  assert.ok(processedOthers.length > 0, "held PRs never crowd the rotation out");
});

test("auto-merge PRs are read once, not once for the queue and again for the sweep", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { calls } = await sweep({ routes: slotRoutes(prs), updateToken: "app" });
  for (const number of [41, 52]) {
    assert.equal(
      calls.filter((c) => c.method === "GET" && c.url.endsWith(`/pulls/${number}`)).length,
      1,
    );
    const sha = prs.find((pr) => pr.number === number).head.sha;
    assert.equal(calls.filter((c) => c.url.includes(`/compare/${BASE_REF}...${sha}`)).length, 1);
  }
});

test("an auto-merge PR whose mergeability never resolves is skipped, not re-polled and updated", async () => {
  const pending = autoPr(52, { mergeable: null });
  let reads = 0;
  const routes = slotRoutes([autoPr(41), pending]);
  routes.unshift({
    method: "GET",
    path: "/pulls/52",
    body: () => (++reads > MERGEABLE_POLL_ATTEMPTS ? { ...pending, mergeable: true } : pending),
  });
  const { results, calls } = await sweep({ routes, updateToken: "app" });
  assert.deepEqual(puts(calls), ["41"], "a second poll reading clean must not make a second racer");
  assert.equal(reads, MERGEABLE_POLL_ATTEMPTS);
  assert.equal(byNumber(results)[52].action, "skipped");
});

test("the queue sees auto-merge PRs past the MAX_PRS slice, so an updated holder stays in view", async () => {
  // The holder was just updated, so it sorts last (updated-asc) and outside the slice.
  const others = Array.from({ length: MAX_PRS }, (_, i) => makePr(200 + i));
  const holder = autoPr(41);
  const prs = [...others, holder, autoPr(52)];
  const { calls } = await sweep({
    routes: [
      listRoute(prs),
      ...slotRoutes([holder, autoPr(52)], { behind: { 41: 0 }, runs: { 41: running("api-tests") } }).slice(1),
    ],
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(calls), [], "#41 is in flight even though the slice no longer shows it");
});

test("a conflicted auto-merge PR still gets its conflict wake and never holds the slot", async () => {
  const prs = [autoPr(41, { mergeable: false, mergeable_state: "dirty" }), autoPr(52)];
  const { results, calls } = await sweep({ routes: slotRoutes(prs), updateToken: "app" });
  assert.deepEqual(puts(calls), ["52"]);
  assert.equal(byNumber(results)[41].verdict, "conflict");
  assert.equal(commentPosts(calls).length, 1);
});

test("without an app token there is no slot: every behind auto-merge PR gets its wake", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { results, calls } = await sweep({ routes: slotRoutes(prs), updateToken: null });
  assert.ok(results.every((r) => r.action === "commented"));
  assert.ok(!calls.some((c) => c.url.includes("/check-runs")));
});

test("checks mode updates the holder and writes nothing else: no wakes, no alert raised", async () => {
  const prs = [autoPr(41), autoPr(52), makePr(74)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(calls), ["41"], "the PR without auto-merge waits for the push sweep");
  assert.deepEqual(
    results.map((r) => [r.number, r.action]),
    [
      [41, "updated"],
      [52, "held"],
    ],
  );
  assert.ok(
    !calls.some((c) => c.method !== "GET" && !c.url.includes("/update-branch")),
    "the base did not move, so nothing but the holder's update is written",
  );
});

test("a checks-mode update closes an open token alert, which it proves wrong", async () => {
  const routes = slotRoutes([autoPr(41)]);
  routes.unshift(
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 777, state: "open", title: ALERT.title, labels: [] }],
    },
    { method: "PATCH", path: "/issues/777", body: { number: 777, state: "closed" } },
  );
  const { calls } = await sweep({ routes, updateToken: "app", mode: "checks" });
  assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/777")));
});

test("a checks-mode failure never raises the alert", async () => {
  const { calls } = await sweep({
    routes: slotRoutes([autoPr(41)], { updates: { 41: updateRoute(41, 401, { message: "Bad credentials" }) } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.equal(filedIssues(calls).length, 0);
});

test("checks mode clears the stale wake of the PR it updates", async () => {
  const routes = slotRoutes([autoPr(41)]);
  routes.unshift(
    { method: "GET", path: "/issues/41/comments", body: [{ id: 9041, body: `${BASE_SYNC_MARKER}\nold` }] },
    { method: "DELETE", path: "/issues/comments/9041", status: 204, body: {} },
  );
  const { calls } = await sweep({ routes, updateToken: "app", mode: "checks" });
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.includes("/comments/9041")));
});

test("checks mode passes the slot on when the holder's update fails, and wakes it once", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { calls } = await sweep({
    routes: slotRoutes(prs, { updates: { 41: updateRoute(41, 422, { message: "Validation Failed" }) } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(calls), ["41", "52"]);
  const posted = commentPosts(calls);
  assert.equal(posted.length, 1, "otherwise it matches the 'held, leave it' signature");
  assert.ok(posted[0].url.includes("/issues/41/comments"));
});

test("checks mode stops on a rejected token, a plain 403 or a rate limit, and wakes nobody", async () => {
  for (const [status, message] of [
    [401, "Bad credentials"],
    [403, "Resource not accessible by integration"],
    [403, "You have exceeded a secondary rate limit"],
  ]) {
    const prs = [autoPr(41), autoPr(52)];
    const { calls } = await sweep({
      routes: slotRoutes(prs, { updates: { 41: updateRoute(41, status, { message }) } }),
      updateToken: "app",
      mode: "checks",
    });
    assert.deepEqual(puts(calls), ["41"], `${status} ${message}: the next PR would fail the same way`);
    assert.equal(commentPosts(calls).length, 0, `${status}: the push sweep diagnoses it in one alert`);
  }
});

test("checks mode moves past a 5xx on one PR, without a wake", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { updates: { 41: updateRoute(41, 502, { message: "Bad Gateway" }) } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(calls), ["41", "52"], "one PR's 5xx must not leave the slot empty");
  assert.equal(byNumber(results)[52].action, "updated");
  assert.equal(commentPosts(calls).length, 0);
});

test("checks mode tries unreadable-checks PRs last, and stops there on a rejected token", async () => {
  const prs = [autoPr(41), autoPr(52), autoPr(63)];
  const fallback = await sweep({
    routes: slotRoutes(prs, { checksStatus: { 41: 403, 52: 403, 63: 403 } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(fallback.calls), ["41"], "the first that updates takes the slot");

  const rejected = await sweep({
    routes: slotRoutes(prs, {
      checksStatus: { 41: 403, 52: 403, 63: 403 },
      updates: { 41: updateRoute(41, 401, { message: "Bad credentials" }) },
    }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(rejected.calls), ["41"], "the rest would fail alike");
});

test("checks mode leaves a conflict to the push sweep, and tries the next PR", async () => {
  const { calls } = await sweep({
    routes: slotRoutes([autoPr(41), autoPr(52)], {
      updates: { 41: updateRoute(41, 422, { message: "merge conflict between base and head" }) },
    }),
    updateToken: "app",
    mode: "checks",
  });
  assert.equal(commentPosts(calls).length, 0);
  assert.deepEqual(puts(calls), ["41", "52"]);
});

test("checks mode sends the head it assessed as expected_head_sha", async () => {
  const { calls } = await sweep({ routes: slotRoutes([autoPr(41)]), updateToken: "app", mode: "checks" });
  const update = calls.find((c) => c.method === "PUT");
  assert.equal(JSON.parse(update.body).expected_head_sha, autoPr(41).head.sha);
});

test("checks mode stops reading once it finds a PR in flight", async () => {
  const prs = [autoPr(41), autoPr(52), autoPr(63)];
  const { calls } = await sweep({
    routes: slotRoutes(prs, { behind: { 41: 0 }, runs: { 41: running("api-tests") } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.equal(calls.filter((c) => c.url.includes("/compare/")).length, 1, "the GITHUB_TOKEN budget is shared");
  assert.ok(!calls.some((c) => /\/pulls\/\d+$/.test(c.url)), "no mergeable polling");
});

test("the holder is judged by the detail's head when an update landed after the list", async () => {
  // The list still shows #41's old (behind, cancelled) head; the detail shows
  // the new one the update just pushed.
  const listed41 = autoPr(41);
  const moved41 = autoPr(41, { head: { ...listed41.head, sha: "9".repeat(40) } });
  const routes = [
    listRoute([listed41, autoPr(52)]),
    detailRoute(moved41),
    compareRoute("9".repeat(40), 0),
    checksRoute("9".repeat(40), running("api-tests")),
    checksRoute(listed41.head.sha, checkRuns({ "api-tests": { conclusion: "cancelled" } })),
    ...slotRoutes([autoPr(52)]).slice(1),
    compareRoute(listed41.head.sha, 1),
  ];
  const { calls } = await sweep({ routes, updateToken: "app", mode: "checks" });
  assert.deepEqual(puts(calls), [], "#41 is in flight on its new head");
});

test("checks mode doesn't re-wake a failing PR that already has a base-sync comment", async () => {
  const routes = slotRoutes([autoPr(41)], { updates: { 41: updateRoute(41, 422, { message: "Validation Failed" }) } });
  routes.unshift({
    method: "GET",
    path: "/issues/41/comments",
    body: [{ id: 1, body: `${BASE_SYNC_MARKER}\nearlier` }],
  });
  const { calls } = await sweep({ routes, updateToken: "app", mode: "checks" });
  assert.equal(commentPosts(calls).length, 0);
});

test("checks mode stops trying once an update stalls to its deadline", STALL_TEST, async () => {
  const prs = [autoPr(41), autoPr(52)];
  const attempted = [];
  await sweep({
    routes: slotRoutes(prs),
    updateToken: "app",
    mode: "checks",
    updateBranchTimeoutMs: 50,
    fetchWrapper: (fetchImpl) => {
      const stalled = stallUpdateBranch(fetchImpl);
      return (url, init) => {
        if (url.includes("/update-branch")) attempted.push(url.match(/pulls\/(\d+)/)[1]);
        return stalled(url, init);
      };
    },
  });
  assert.deepEqual(attempted, ["41"], "a second two-minute wait would run the job out");
});

test("the slot falls to an unreadable-checks PR when none other can take it, and the rest wait", async () => {
  const prs = [autoPr(41), autoPr(52), autoPr(63)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { checksStatus: { 41: 403, 52: 403, 63: 403 } }),
    updateToken: "app",
  });
  assert.deepEqual(puts(calls), ["41"], "the first that updates holds the slot");
  assert.equal(byNumber(results)[52].action, "held");
  assert.equal(byNumber(results)[63].holder, 41);
});

test("the slot governs at most MAX_AUTO_MERGE_PRS auto-merge PRs", async () => {
  const prs = Array.from({ length: MAX_AUTO_MERGE_PRS + 2 }, (_, i) => autoPr(500 + i));
  const { calls } = await sweep({ routes: slotRoutes(prs), updateToken: "app" });
  assert.equal(calls.filter((c) => c.url.includes("/check-runs")).length, MAX_AUTO_MERGE_PRS);
});

test("the slot is filled before the rest of the sweep", async () => {
  const prs = [makePr(74), autoPr(41)];
  const { calls } = await sweep({ routes: slotRoutes(prs), updateToken: "app" });
  assert.deepEqual(puts(calls), ["41", "74"]);
});

test("checks mode: a head-moved 422 keeps the slot and starts no second PR", async () => {
  const prs = [autoPr(41), autoPr(52)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs, { updates: { 41: updateRoute(41, 422, RACE_422) } }),
    updateToken: "app",
    mode: "checks",
  });
  assert.deepEqual(puts(calls), ["41"]);
  assert.equal(byNumber(results)[41].action, "raced");
  assert.equal(byNumber(results)[52].action, "held");
});

test("checks mode without an app token reads nothing and writes nothing", async () => {
  const { results, calls } = await sweep({
    routes: slotRoutes([autoPr(41)]),
    updateToken: null,
    mode: "checks",
  });
  assert.deepEqual(results, []);
  assert.equal(calls.length, 0);
});

test("a CI completion or the schedule selects checks mode; a push the full sweep", () => {
  assert.equal(sweepModeFor("workflow_run"), "checks");
  assert.equal(sweepModeFor("schedule"), "checks");
  assert.equal(sweepModeFor("push"), "push");
});

test("a PR whose auto-merge was turned off since the list was read takes the ordinary path", async () => {
  const { results, calls } = await sweep({
    routes: [listRoute([autoPr(41), autoPr(52)]), ...slotRoutes([makePr(41), autoPr(52)]).slice(1)],
    updateToken: "app",
  });
  assert.deepEqual(puts(calls).sort(), ["41", "52"], "#41 is no longer queued, so it is not held");
  assert.equal(byNumber(results)[41].action, "updated");
});

// ── readRequiredChecks / pickSlotOrder ──────────────────────────────────────

async function readChecks(body, { status = 200 } = {}) {
  const { fetchImpl } = makeFetchMock([{ method: "GET", path: "/check-runs", status, body }]);
  return readRequiredChecks({
    token: "t",
    repo: REPO,
    sha: "abc",
    fetchImpl,
    retryOptions: { attempts: 1 },
  });
}
const stateOf = async (body, opts) => (await readChecks(body, opts))?.state ?? null;

test("readRequiredChecks: all green is passed; one still running is running", async () => {
  assert.equal(await stateOf({ check_runs: checkRuns() }), "passed");
  assert.equal(await stateOf({ check_runs: running("api-tests") }), "running");
});

test("readRequiredChecks: a failed or cancelled required check is failed, even beside a running one", async () => {
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const runs = checkRuns({
      "api-tests": { conclusion },
      "mobile-validate": { status: "in_progress", conclusion: null },
    });
    assert.equal(await stateOf({ check_runs: runs }), "failed", conclusion);
  }
});

test("readRequiredChecks: the newest run of a re-run check decides", async () => {
  const runs = [
    ...checkRuns({ "api-tests": { conclusion: "failure", started_at: "2026-11-06T19:00:00Z" } }),
    { name: "api-tests", status: "in_progress", conclusion: null, started_at: "2026-11-06T19:10:00Z" },
  ];
  assert.equal(await stateOf({ check_runs: runs }), "running");
});

test("readRequiredChecks: a never-reported check is missing; a non-required failure does not count", async () => {
  const runs = [
    ...checkRuns().filter((run) => run.name !== "landing-fold"),
    { name: "duplicate-detection", status: "completed", conclusion: "failure" },
  ];
  assert.equal(await stateOf({ check_runs: runs }), "missing");
  assert.equal(await stateOf({ check_runs: [] }), "missing");
});

test("readRequiredChecks: reports when the last required check completed", async () => {
  const runs = checkRuns({ "api-tests": { completed_at: "2026-11-06T19:30:00Z" } });
  assert.equal((await readChecks({ check_runs: runs })).lastCompletedMs, Date.parse("2026-11-06T19:30:00Z"));
});

test("readRequiredChecks: an unreadable checks API is null, never passed", async () => {
  assert.equal(await readChecks({ message: "boom" }, { status: 502 }), null);
  assert.equal(await readChecks({ unexpected: true }), null);
});

test("readRequiredChecks retries a transient failure instead of dropping the holder", async () => {
  let attempt = 0;
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/check-runs",
      body: () => (++attempt === 1 ? "<html>bad gateway</html>" : { check_runs: checkRuns() }),
    },
  ]);
  const flaky = async (url, init) => {
    const response = await fetchImpl(url, init);
    return attempt === 1 ? { ...response, ok: false, status: 502 } : response;
  };
  const result = await readRequiredChecks({
    token: "t",
    repo: REPO,
    sha: "abc",
    fetchImpl: flaky,
    retryOptions: { backoffMs: [0] },
  });
  assert.equal(result?.state, "passed");
  assert.equal(attempt, 2);
});

test("pickSlotOrder: unreadable, forked or red PRs never take the slot", () => {
  const base = { isFork: false, pr: { mergeable: true } };
  const passed = { state: "passed", lastCompletedMs: 0 };
  assert.equal(
    pickSlotOrder([{ ...base, number: 1, behindBy: null, checks: null }], NOW).inFlight,
    1,
    "an unreadable compare holds the slot fail-safe",
  );
  const slot = pickSlotOrder(
    [
      { ...base, number: 2, behindBy: 1, checks: null },
      { ...base, number: 3, behindBy: 1, checks: { state: "failed", lastCompletedMs: 0 } },
      { ...base, number: 4, isFork: true, behindBy: 1, checks: passed },
      { ...base, number: 5, behindBy: 1, checks: passed },
    ],
    NOW,
  );
  assert.deepEqual(slot.order, [5]);
  assert.deepEqual(slot.queued, [2, 5], "the unreadable one is governed, so it can be held");
  assert.equal(pickSlotOrder([], NOW).inFlight, null);
});

test("isInFlight: only an up-to-date, same-repo, unconflicted PR can be in flight", () => {
  const c = {
    isFork: false,
    pr: { mergeable: true },
    checks: { state: "running", lastCompletedMs: 0 },
  };
  assert.equal(isInFlight({ ...c, behindBy: 0 }, NOW), true);
  assert.equal(isInFlight({ ...c, behindBy: 2 }, NOW), false);
  assert.equal(isInFlight({ ...c, behindBy: 0, isFork: true }, NOW), false);
  assert.equal(isInFlight({ ...c, behindBy: 0, pr: { mergeable: false } }, NOW), false);
  assert.equal(isInFlight({ ...c, behindBy: 0, checks: { state: "failed" } }, NOW), false);
});

// ── A registry merge, the update slot and the token alert (#3783) ────────────

// Not held behind the slot: a conflicted PR is outside the slot's queue and no
// slot sweep reaches it, so a hold would leave a record PR conflicted (its builds
// unprotected) until an unrelated push to main. Pushing costs one racing CI run.
test("an auto-merge PR's registry merge is pushed even while another PR takes the update slot", async () => {
  const holder = autoPr(44);
  const record = autoPr(45, { mergeable: false, mergeable_state: "dirty" });
  const { results, calls } = await sweep({
    routes: [
      ...slotRoutes([holder, record]),
      ...registryConflictRoutes(record, [{ filename: REGISTRY }], { listed: false }),
    ],
    updateToken: "app",
  });
  const got = byNumber(results);
  assert.equal(got[44].action, "updated");
  assert.equal(got[45].action, "registry-merged");
  assert.ok(calls.some((c) => c.method === "PATCH" && c.url.endsWith(`/git/refs/heads/${record.head.ref}`)));
  assert.equal(commentPosts(calls).length, 0);
});

const openAlertRoutes = [
  { method: "GET", path: "/issues?state=all", body: [{ number: 900, state: "open", title: ALERT.title }] },
  { method: "PATCH", path: "/issues/900", status: 200, body: {} },
  { method: "POST", path: "/issues/900/comments", status: 201, body: { id: 2 } },
];

test("a registry merge is not update-branch proof: it closes the alert only as a quiet sweep would", async () => {
  const record = makePr(47, { mergeable: false, mergeable_state: "dirty" });
  const { calls } = await sweep({
    routes: [...registryConflictRoutes(record, [{ filename: REGISTRY }]), ...openAlertRoutes],
    updateToken: "app",
  });
  const comment = calls.find((c) => c.method === "POST" && c.url.includes("/issues/900/comments"));
  assert.match(JSON.parse(comment.body).body, /absence of the fault/);
});

test("a registry merge beside a blocked update-branch leaves the token alert raised", async () => {
  const record = makePr(48, { mergeable: false, mergeable_state: "dirty" });
  const behind = makePr(49);
  const { calls } = await sweep({
    routes: [
      listRoute([record, behind]),
      detailRoute(record),
      detailRoute(behind),
      ...registryConflictRoutes(record, [{ filename: REGISTRY }], { listed: false }),
      compareRoute(behind.head.sha, 1),
      { method: "PUT", path: "/pulls/49/update-branch", status: 403, body: { message: "Resource not accessible by integration" } },
      { method: "POST", path: "/issues/49/comments", status: 201, body: { id: 3 } },
      ...openAlertRoutes,
    ],
    updateToken: "app",
  });
  assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/git/refs/heads/")), "the registry merge went through");
  assert.ok(!calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/900")), "the open alert stays open");
});

test("a refused registry merge never closes the token alert", async () => {
  const record = makePr(50, { mergeable: false, mergeable_state: "dirty" });
  const routes = registryConflictRoutes(record, [{ filename: REGISTRY }]).map((r) =>
    r.method === "PATCH" ? { ...r, status: 403, body: { message: "Resource not accessible by integration" } } : r,
  );
  const { calls } = await sweep({
    routes: [...routes, { method: "POST", path: "/issues/50/comments", status: 201, body: { id: 4 } }, ...openAlertRoutes],
    updateToken: "app",
  });
  assert.ok(!calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/900")));
});

// ── Up to date not required (REQUIRE_UP_TO_DATE false, 2026-11-11) ──────────
// A clean PR can merge while behind, so the sweep leaves it alone: an update
// would only restart its CI. Conflicts are still the sweep's to report.

test("the sweep follows the roster's up-to-date rule by default", async () => {
  const pr = makePr(12);
  const { fetchImpl, calls } = makeFetchMock([listRoute([pr]), detailRoute(pr), emptyCommentsRoute]);
  const results = await processBaseMove({
    token: "t",
    updateToken: "app",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl,
    sleep: makeSleep().sleep,
    logger: quiet,
  });
  if (REQUIRE_UP_TO_DATE) {
    assert.ok(calls.some((c) => c.url.includes("/compare/")), "with the rule on, a clean PR is compared");
  } else {
    assert.deepEqual(results, [{ number: 12, verdict: "clean", action: "none" }]);
  }
});

test("rule off: a behind, clean PR is left as is, with no update, no compare and no wake", async () => {
  const pr = makePr(12);
  const { results, calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), emptyCommentsRoute],
    updateToken: "app",
    requireUpToDate: false,
  });
  assert.deepEqual(results, [{ number: 12, verdict: "clean", action: "none" }]);
  assert.ok(!calls.some((c) => c.method === "PUT"), "no update-branch");
  // The only compare is the migration-order read (#4558), which is against the base's sha.
  assert.ok(!calls.some((c) => c.url.includes(`/compare/${BASE_REF}...`)), "behind or not doesn't matter");
  assert.equal(commentPosts(calls).length, 0);
  assert.equal(filedIssues(calls).length, 0, "nothing blocked, so no alert");
});

test("rule off: a push sweep waits for mergeable to settle before reading a PR; a slot sweep doesn't", async () => {
  const pr = makePr(12);
  const { fetchImpl, calls } = makeFetchMock([listRoute([pr]), detailRoute(pr), emptyCommentsRoute]);
  const { sleep, sleeps } = makeSleep();
  const order = [];
  await processBaseMove({
    requireUpToDate: false,
    token: "t",
    updateToken: "app",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl: (url, init) => (order.push("fetch"), fetchImpl(url, init)),
    sleep: async (ms) => (order.push(`sleep ${ms}`), sleep(ms)),
    logger: quiet,
  });
  assert.equal(order[0], `sleep ${MERGEABLE_SETTLE_MS}`, "the wait comes before the PR list");
  assert.ok(calls.length > 0);
  const slot = makeSleep();
  await processBaseMove({
    requireUpToDate: false,
    mode: "checks",
    token: "t",
    updateToken: "app",
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl,
    sleep: slot.sleep,
    logger: quiet,
  });
  assert.deepEqual(slot.sleeps, []);
  assert.deepEqual(sleeps, [MERGEABLE_SETTLE_MS]);
});

test("rule off: an open token alert is neither closed nor commented on", async () => {
  const pr = makePr(12);
  const { results, calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      emptyCommentsRoute,
      { method: "GET", path: "/issues?state=all", body: [{ number: 900, state: "open", title: "PR base sync cannot auto-update PR branches" }] },
    ],
    updateToken: "app",
    requireUpToDate: false,
  });
  assert.equal(results[0].verdict, "clean");
  assert.ok(!calls.some((c) => c.url.includes("/issues?")), "the alert isn't even looked up");
  assert.ok(!calls.some((c) => c.method === "PATCH"));
});

test("rule off: no app token is not an alert, because nothing needs updating", async () => {
  const pr = makePr(12);
  const { results, calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), emptyCommentsRoute],
    requireUpToDate: false,
  });
  assert.deepEqual(results, [{ number: 12, verdict: "clean", action: "none" }]);
  assert.equal(commentPosts(calls).length, 0);
  assert.equal(filedIssues(calls).length, 0);
});

test("rule off: a stale wake on a clean PR is deleted", async () => {
  const pr = makePr(52);
  const { calls } = await sweep({
    routes: [
      listRoute([pr]),
      detailRoute(pr),
      {
        method: "GET",
        path: "/issues/52/comments",
        body: [{ id: 9052, body: `${BASE_SYNC_MARKER}\n**Base-branch sync** — merge it yourself` }],
      },
      { method: "DELETE", path: "/issues/comments/9052", status: 204, body: {} },
    ],
    updateToken: "app",
    requireUpToDate: false,
  });
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.includes("/comments/9052")));
});

test("rule off: a conflicted PR still gets its wake", async () => {
  const pr = makePr(11, { mergeable: false, mergeable_state: "dirty" });
  const { results, calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), emptyCommentsRoute],
    updateToken: "app",
    requireUpToDate: false,
  });
  assert.deepEqual(results, [{ number: 11, verdict: "conflict", action: "commented" }]);
  assert.ok(!calls.some((c) => c.method === "PUT"));
});

test("rule off: auto-merge PRs get no slot, and none is held", async () => {
  const prs = [autoPr(63), autoPr(41), autoPr(52)];
  const { results, calls } = await sweep({
    routes: slotRoutes(prs),
    updateToken: "app",
    requireUpToDate: false,
  });
  assert.deepEqual(puts(calls), [], "nothing is updated");
  assert.ok(!calls.some((c) => c.url.includes("/check-runs")), "no slot assessment");
  assert.ok(results.every((r) => r.action === "none" && r.verdict === "clean"));
});

test("rule off: a slot sweep does nothing at all", async () => {
  const { results, calls } = await sweep({
    routes: slotRoutes([autoPr(41)]),
    updateToken: "app",
    mode: "checks",
    requireUpToDate: false,
  });
  assert.deepEqual(results, []);
  assert.deepEqual(calls, [], "not even the PR list");
});

// ── Migrations that no longer sort after main's (#4558 item 6) ──────────────

// main took 160000 while the PR's 150000 waited, so the PR's sorts before it.
const MIG = "supabase/migrations/20261112150000_add_widgets.sql";
const MIG_PAGE = "docs/ops/database/migrations/20261112150000_add_widgets.md";
const MAIN_MIG = "20261112160000_main_took_this.sql";
// NOW is before main's newest version, so the fresh version is one second after it.
const MOVED = "20261112160001_add_widgets";
const blobOf = (text) => ({ content: Buffer.from(text).toString("base64") });

function renumberRoutes(pr, {
  files = [
    { filename: MIG, status: "added" },
    { filename: MIG_PAGE, status: "added" },
    { filename: "apps/api/src/widgets.ts", status: "modified" },
  ],
  texts = {
    [MIG]: "-- add widgets\ncreate table widgets ();\n",
    [MIG_PAGE]: "# 20261112150000_add_widgets.sql\n\n## Promotion\n\n## Rollback\n",
    "apps/api/src/widgets.ts": "// schema: 20261112150000_add_widgets\nexport const x = 1;\n",
  },
  baseMigrations = [MAIN_MIG],
  parents = [BASE_SHA, pr.head.sha],
  listed = true,
  headNow,
} = {}) {
  const merge = pr.merge_commit_sha;
  const paths = Object.keys(texts);
  return [
    ...(listed ? [listRoute([pr]), detailRoute(pr)] : []),
    { method: "GET", path: `/compare/${BASE_SHA}...${pr.head.sha}?per_page=1`, body: { files } },
    {
      method: "GET",
      path: "/contents/supabase/migrations?ref=",
      body: baseMigrations.map((name) => ({ name })),
    },
    { method: "GET", path: `/git/commits/${merge}`, body: { tree: { sha: "mergetree" }, parents: parents.map((sha) => ({ sha })) } },
    {
      method: "GET",
      path: "/git/trees/mergetree?recursive=1",
      body: {
        truncated: false,
        tree: [
          ...paths.map((path, i) => ({ path, mode: "100644", type: "blob", sha: `blob${i}` })),
          { path: `supabase/migrations/${MAIN_MIG}`, mode: "100644", type: "blob", sha: "mainblob" },
        ],
      },
    },
    ...paths.map((path, i) => ({ method: "GET", path: `/git/blobs/blob${i}`, body: blobOf(texts[path]) })),
    { method: "POST", path: "/git/trees", body: { sha: "newtree" } },
    { method: "POST", path: "/git/commits", body: { sha: "8".repeat(40) } },
    { method: "GET", path: `/git/ref/heads/${pr.head.ref}`, body: { object: { sha: headNow ?? pr.head.sha } } },
    { method: "PATCH", path: "/git/refs/heads/", body: {} },
    emptyCommentsRoute,
    { method: "POST", path: `/issues/${pr.number}/comments`, status: 201, body: { id: 1 } },
  ];
}
const migrationPr = (number, overrides = {}) => makePr(number, { merge_commit_sha: "7".repeat(40), ...overrides });
const gitWrites = (calls) => calls.filter((c) => c.method !== "GET" && c.url.includes("/git/"));

test("a clean PR whose migration sorts before main's is merged and renumbered with the app token, with no wake", async () => {
  const pr = migrationPr(50);
  const { logger, lines } = capture();
  const { results, calls } = await sweep({
    routes: renumberRoutes(pr),
    updateToken: "pat",
    requireUpToDate: false,
    logger,
  });
  assert.deepEqual(results, [{ number: 50, verdict: "migration-order", action: "renumbered" }]);
  assert.equal(commentPosts(calls).length, 0, "no wake");

  const tree = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/git/trees")).body);
  assert.equal(tree.base_tree, "mergetree", "built on GitHub's test merge, so main's changes come along");
  const byPath = new Map(tree.tree.map((e) => [e.path, e]));
  assert.equal(byPath.get(MIG).sha, null, "the old migration is removed");
  assert.equal(byPath.get(MIG_PAGE).sha, null, "and its old ledger page");
  assert.equal(byPath.get(`supabase/migrations/${MOVED}.sql`).sha, "blob0", "an unchanged file moves by blob");
  assert.match(byPath.get(`docs/ops/database/migrations/${MOVED}.md`).content, new RegExp(`^# ${MOVED}\\.sql`));
  assert.match(byPath.get("apps/api/src/widgets.ts").content, new RegExp(`schema: ${MOVED}\\n`));
  assert.ok(!byPath.has(`supabase/migrations/${MAIN_MIG}`), "main's migration is not touched");

  const commit = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/git/commits")).body);
  assert.deepEqual(commit.parents, [pr.head.sha, BASE_SHA], "a merge of main into the branch");
  assert.match(commit.message, /20261112150000_add_widgets\.sql -> 20261112160001_add_widgets\.sql/);
  const ref = calls.find((c) => c.method === "PATCH");
  assert.ok(ref.url.endsWith(`/git/refs/heads/${pr.head.ref}`));
  assert.deepEqual(JSON.parse(ref.body), { sha: "8".repeat(40), force: false });
  // Reads stay on GITHUB_TOKEN; only the git writes use the App's.
  for (const c of calls) assert.equal(c.token, gitWrites([c]).length ? "pat" : "t", `${c.method} ${c.url}`);
  assert.ok(lines.some((l) => /#50: migrations sorted before main's — merged main and renumbered 20261112150000->20261112160001/.test(l)));
});

test("a PR whose migrations still sort after main's is left as it is", async () => {
  const pr = migrationPr(51);
  const { results, calls } = await sweep({
    routes: renumberRoutes(pr, { baseMigrations: ["20261112140000_older.sql"] }),
    updateToken: "pat",
    requireUpToDate: false,
  });
  assert.deepEqual(results, [{ number: 51, verdict: "clean", action: "none" }]);
  assert.equal(gitWrites(calls).length, 0);
  assert.ok(!calls.some((c) => c.url.includes("/git/")), "nothing past the listing is read");
  assert.equal(commentPosts(calls).length, 0);
});

test("a PR that adds no migration costs one compare, and the base's list is never read", async () => {
  const pr = migrationPr(52);
  const { results, calls } = await sweep({
    routes: renumberRoutes(pr, { files: [{ filename: "apps/web/page.tsx", status: "modified" }] }),
    updateToken: "pat",
    requireUpToDate: false,
  });
  assert.deepEqual(results, [{ number: 52, verdict: "clean", action: "none" }]);
  assert.ok(!calls.some((c) => c.url.includes("/contents/")));
});

test("without the app token the PR gets the exact command, and nothing touches git", async () => {
  const pr = migrationPr(53);
  const { results, calls } = await sweep({ routes: renumberRoutes(pr), requireUpToDate: false });
  assert.deepEqual(results, [{ number: 53, verdict: "migration-order", action: "commented" }]);
  assert.equal(gitWrites(calls).length, 0);
  const body = JSON.parse(commentPosts(calls)[0].body).body;
  assert.ok(body.startsWith(BASE_SYNC_MARKER));
  assert.match(body, /npm run migration:renumber/);
  assert.match(body, /no app token/);
  assert.match(body, /`20261112150000_add_widgets\.sql`/);
});

for (const [name, options, reason] of [
  ["the branch changes a workflow", { files: [{ filename: MIG, status: "added" }, { filename: ".github/workflows/ci.yml", status: "modified" }] }, /\.github\/workflows/],
  [
    "a changed file still names the old version on its own",
    {
      texts: {
        [MIG]: "-- add widgets\n",
        [MIG_PAGE]: "# 20261112150000_add_widgets.sql\n\nselect * from ledger where version = '20261112150000';\n",
      },
    },
    /still names an old version on its own, which may be main's migration: docs\/ops\/database\/migrations\/20261112150000_add_widgets\.md \(20261112150000\)/,
  ],
]) {
  test(`no push, and the exact command instead, when ${name}`, async () => {
    const pr = migrationPr(54);
    const { results, calls } = await sweep({ routes: renumberRoutes(pr, options), updateToken: "pat", requireUpToDate: false });
    assert.equal(results[0].action, "commented");
    assert.equal(gitWrites(calls).length, 0);
    assert.match(JSON.parse(commentPosts(calls)[0].body).body, reason);
  });
}

test("a test merge not yet of the new base is left for the next sweep: no push, no wake", async () => {
  const pr = migrationPr(54);
  const { logger, lines } = capture();
  const { results, calls } = await sweep({
    routes: renumberRoutes(pr, { parents: ["0".repeat(40), pr.head.sha] }),
    updateToken: "pat",
    requireUpToDate: false,
    logger,
  });
  assert.deepEqual(results, [{ number: 54, verdict: "clean", action: "none" }]);
  assert.equal(gitWrites(calls).length, 0);
  assert.equal(commentPosts(calls).length, 0);
  assert.ok(lines.some((l) => /#54: could not check its migrations' order \(GitHub's test merge is not of this head/.test(l)));
});

test("a compare list long enough to be cut is not read as 'no migration'", async () => {
  // The migration sorts last by path, so it is the file a cut list drops.
  const files = Array.from({ length: 300 }, (_, i) => ({ filename: `apps/web/f${i}.ts`, status: "modified" }));
  const pr = migrationPr(61);
  const { logger, lines } = capture();
  const { results, calls } = await sweep({ routes: renumberRoutes(pr, { files }), updateToken: "pat", requireUpToDate: false, logger });
  assert.deepEqual(results, [{ number: 61, verdict: "clean", action: "none" }]);
  assert.ok(!calls.some((c) => c.url.includes("/contents/")));
  assert.ok(lines.some((l) => /#61: could not check .*300 files or more/.test(l)));
});

test("more changed files than the sweep reads gets the command, not a push", async () => {
  const files = [{ filename: MIG, status: "added" }, ...Array.from({ length: 60 }, (_, i) => ({ filename: `apps/web/f${i}.ts`, status: "modified" }))];
  const pr = migrationPr(62);
  const { results, calls } = await sweep({ routes: renumberRoutes(pr, { files }), updateToken: "pat", requireUpToDate: false });
  assert.equal(results[0].action, "commented");
  assert.ok(!calls.some((c) => c.url.includes("/git/")));
  assert.match(JSON.parse(commentPosts(calls)[0].body).body, /more than 60 files/);
});

test("a cut tree listing gets the command, not a push", async () => {
  const pr = migrationPr(63);
  const routes = renumberRoutes(pr).map((r) =>
    r.path === "/git/trees/mergetree?recursive=1" ? { ...r, body: { ...r.body, truncated: true } } : r,
  );
  const { results, calls } = await sweep({ routes, updateToken: "pat", requireUpToDate: false });
  assert.equal(results[0].action, "commented");
  assert.equal(gitWrites(calls).length, 0);
  assert.match(JSON.parse(commentPosts(calls)[0].body).body, /cut short/);
});

test("a branch moved back since it was read is not fast-forwarded over", async () => {
  // A force-push that dropped a commit (a leaked secret, say) would otherwise get it back.
  const pr = migrationPr(64);
  const { results, calls } = await sweep({
    routes: renumberRoutes(pr, { headNow: "1".repeat(40) }),
    updateToken: "pat",
    requireUpToDate: false,
  });
  assert.equal(results[0].renumberRefused, true);
  assert.ok(!calls.some((c) => c.method === "PATCH"), "the ref is never moved");
  assert.match(JSON.parse(commentPosts(calls)[0].body).body, /branch moved since the sweep read it/);
});

test("a PR already in order is not renumbered because another PR was earlier in the sweep", async () => {
  const a = migrationPr(65);
  const b = migrationPr(66, { merge_commit_sha: "6".repeat(40) });
  const inOrder = "supabase/migrations/20261112170000_later.sql";
  const { results, calls } = await sweep({
    routes: [
      listRoute([a, b]),
      detailRoute(a),
      detailRoute(b),
      ...renumberRoutes(a, { listed: false }),
      ...renumberRoutes(b, { listed: false, files: [{ filename: inOrder, status: "added" }] }),
    ],
    updateToken: "pat",
    requireUpToDate: false,
  });
  assert.deepEqual(results.map((r) => r.action), ["renumbered", "none"]);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1, "only the PR that was out of order is pushed");
});

test("a fork's PR is never pushed to; it gets the command", async () => {
  const pr = migrationPr(55, { head: { ref: "feature", sha: "55".padStart(40, "0"), repo: { full_name: "someone/Frapp" } } });
  const { results, calls } = await sweep({ routes: renumberRoutes(pr), updateToken: "pat", requireUpToDate: false });
  assert.equal(results[0].action, "commented");
  assert.ok(!calls.some((c) => c.url.includes("/git/")), "nothing of the fork's is read or written");
  assert.match(JSON.parse(commentPosts(calls)[0].body).body, /lives in a fork/);
});

test("a refused renumber push falls back to the command, and proves nothing about the token", async () => {
  const pr = migrationPr(56);
  const routes = renumberRoutes(pr).map((r) =>
    r.method === "PATCH" ? { ...r, status: 403, body: { message: "Resource not accessible by integration" } } : r,
  );
  const { results, calls } = await sweep({ routes, updateToken: "pat", requireUpToDate: false });
  assert.deepEqual(results, [{ number: 56, verdict: "migration-order", action: "commented", renumberRefused: true }]);
  assert.match(JSON.parse(commentPosts(calls)[0].body).body, /GitHub refused the push: PATCH .* \(HTTP 403/);
});

test("two PRs renumbered in one sweep get different versions", async () => {
  const a = migrationPr(57);
  const b = migrationPr(58, { merge_commit_sha: "6".repeat(40) });
  const { results, calls } = await sweep({
    routes: [
      listRoute([a, b]),
      detailRoute(a),
      detailRoute(b),
      ...renumberRoutes(a, { listed: false }),
      ...renumberRoutes(b, { listed: false, parents: [BASE_SHA, b.head.sha] }),
    ],
    updateToken: "pat",
    requireUpToDate: false,
  });
  assert.deepEqual(results.map((r) => r.action), ["renumbered", "renumbered"]);
  const moved = calls
    .filter((c) => c.method === "POST" && c.url.endsWith("/git/trees"))
    .map((c) => JSON.parse(c.body).tree.find((e) => e.path.startsWith("supabase/migrations/") && e.sha !== null).path);
  assert.deepEqual(moved, [`supabase/migrations/${MOVED}.sql`, "supabase/migrations/20261112160002_add_widgets.sql"]);
});

test("a compare that can't be read leaves the PR on its usual path", async () => {
  const pr = migrationPr(59);
  const { logger, lines } = capture();
  const { results } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), { method: "GET", path: `/compare/${BASE_SHA}`, status: 500, body: {} }, emptyCommentsRoute],
    updateToken: "pat",
    requireUpToDate: false,
    logger,
  });
  assert.deepEqual(results, [{ number: 59, verdict: "clean", action: "none" }]);
  assert.ok(lines.some((l) => /#59: could not check its migrations' order/.test(l)));
});

test("with the up-to-date rule on, a renumber is an update: it takes the slot", async () => {
  const first = migrationPr(60, AUTO);
  const second = autoPr(70);
  const { results, calls } = await sweep({
    routes: [...renumberRoutes(first, { listed: false }), ...slotRoutes([first, second])],
    updateToken: "app",
  });
  const r = byNumber(results);
  assert.equal(r[60].action, "renumbered");
  assert.equal(r[70].action, "held", "a second PR updated beside it would race its CI");
  assert.deepEqual(puts(calls), [], "no update-branch for either");
});

test("a refused renumber never closes the token alert", async () => {
  const pr = migrationPr(67);
  const routes = renumberRoutes(pr).map((r) =>
    r.method === "PATCH" ? { ...r, status: 403, body: { message: "Resource not accessible by integration" } } : r,
  );
  const { calls } = await sweep({ routes: [...routes, compareRoute(pr.head.sha, 1), ...openAlertRoutes], updateToken: "app" });
  assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/git/refs/heads/")), "the push was tried");
  assert.ok(!calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/900")));
});

test("the renumber wake names each migration and the reason", () => {
  const body = buildRenumberComment({
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    pr: makePr(7),
    renames: [{ from: "20261112150000_a.sql", to: "20261112160001_a.sql" }],
    reason: "the head branch lives in a fork, which this sweep cannot push to",
  });
  assert.ok(body.startsWith(BASE_SYNC_MARKER));
  assert.match(body, /no longer sort after/);
  assert.match(body, /git merge origin\/main/);
  assert.match(body, /`20261112150000_a\.sql`/);
  assert.match(body, /lives in a fork/);
});
