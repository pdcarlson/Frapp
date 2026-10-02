import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT,
  BASE_SYNC_MARKER,
  MAX_PRS,
  MERGEABLE_POLL_ATTEMPTS,
  UPDATE_BRANCH_STALLS_BEFORE_STOP,
  buildBehindComment,
  buildConflictComment,
  compareBehindBy,
  fetchPrWithMergeable,
  processBaseMove,
} from "../pr-base-sync.mjs";

const REPO = "pdcarlson/Frapp";
const BASE_REF = "main";
const BASE_SHA = "aabbccddeeff00112233445566778899aabbccdd";

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

function sweep({ routes, updateToken = null, fetchWrapper = (f) => f, logger = quiet }) {
  const { fetchImpl, calls } = makeFetchMock(routes);
  const run = processBaseMove({
    token: "t",
    updateToken,
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl: fetchWrapper(fetchImpl),
    sleep: makeSleep().sleep,
    logger,
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
