import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_ISSUE_TITLE,
  BASE_SYNC_MARKER,
  MAX_PRS,
  MERGEABLE_POLL_ATTEMPTS,
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

function sweep({ routes, updateToken = null, fetchWrapper = (f) => f }) {
  const { fetchImpl, calls } = makeFetchMock(routes);
  const run = processBaseMove({
    token: "t",
    updateToken,
    repo: REPO,
    baseRef: BASE_REF,
    baseSha: BASE_SHA,
    fetchImpl: fetchWrapper(fetchImpl),
    sleep: makeSleep().sleep,
    logger: quiet,
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

test("behind with no app token: ONE alert issue, and no comment on the PR", async () => {
  const pr = makePr(13);
  const { results, calls } = await sweep({
    routes: [listRoute([pr]), detailRoute(pr), compareRoute(pr.head.sha, 1), emptyCommentsRoute],
    updateToken: null,
  });
  assert.equal(results[0].number, 13);
  assert.equal(results[0].verdict, "behind");
  assert.equal(results[0].action, "blocked");
  assert.ok(!calls.some((c) => c.url.includes("/update-branch")));
  assert.ok(
    !calls.some((c) => c.method === "POST" && c.url.includes("/issues/13/comments")),
    "a repo-wide cause must not be restated on every PR",
  );
  const filed = calls.find(
    (c) => c.method === "POST" && /\/issues$/.test(c.url.split("?")[0]),
  );
  assert.ok(filed, "the sweep files one alert issue instead");
  assert.equal(JSON.parse(filed.body).title, ALERT_ISSUE_TITLE);
  assert.match(JSON.parse(filed.body).body, /PR_BASE_SYNC_APP_CLIENT_ID/);
});

test("no app token: twenty behind PRs still file exactly one alert issue", async () => {
  const prs = Array.from({ length: 20 }, (_, i) => makePr(100 + i));
  const { calls } = await sweep({
    routes: [
      listRoute(prs),
      ...prs.map(detailRoute),
      ...prs.map((pr) => compareRoute(pr.head.sha, 1)),
      emptyCommentsRoute,
    ],
    updateToken: null,
  });
  const filed = calls.filter(
    (c) => c.method === "POST" && /\/issues$/.test(c.url.split("?")[0]),
  );
  assert.equal(filed.length, 1, "one alert for the sweep, not one per PR");
  assert.equal(
    calls.filter((c) => c.method === "POST" && c.url.includes("/comments")).length,
    0,
    "this is the twenty-identical-comments case the alert exists to replace",
  );
});

test("a rejected app token takes the alert path, not twenty comments", async () => {
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
  assert.equal(results[0].action, "blocked");
  assert.match(results[0].detail, /rejected/);
  assert.ok(
    !calls.some((c) => c.method === "POST" && c.url.includes("/issues/15/comments")),
  );
  assert.ok(
    calls.some((c) => c.method === "POST" && /\/issues$/.test(c.url.split("?")[0])),
  );
});

test("a successful update closes an open alert; a quiet sweep does not", async () => {
  const openAlert = [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }];
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

  // A sweep where nothing was behind proves nothing about the token.
  const inSync = makePr(17);
  const quietSweep = await sweep({
    routes: [
      listRoute([inSync]),
      detailRoute(inSync),
      compareRoute(inSync.head.sha, 0),
      alertLookupRoute,
      emptyCommentsRoute,
    ],
    updateToken: "app-token",
  });
  assert.ok(
    !quietSweep.calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/900")),
    "a no-op sweep must never close a live alert",
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
