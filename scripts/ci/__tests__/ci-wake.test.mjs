import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RUN_ATTEMPTS,
  buildWakeComment,
  classifyRun,
  findOpenPrNumber,
  jobFailedInRealStep,
  processCompletedRun,
  requeueRun,
  upsertWakeComment,
  wakeMarkerFor,
} from "../ci-wake.mjs";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Modeled on the real 2026-08-06 outage on PR #659, run 31119232391 attempt 1:
// secret-scan failed with EXACTLY one step ("Set up job") after "Failed to
// resolve action download info. Error: Service Unavailable"; six sibling jobs
// were cancelled without ever getting a runner; eight were skipped.

const outageSecretScanJob = {
  name: "secret-scan",
  conclusion: "failure",
  steps: [{ name: "Set up job", number: 1, conclusion: "failure" }],
};

const outageCancelledJob = {
  name: "packages-build",
  conclusion: "cancelled",
  steps: [],
};

const startedThenCancelledJob = {
  name: "api-tests",
  conclusion: "cancelled",
  steps: [
    { name: "Set up job", number: 1, conclusion: "success" },
    { name: "Checkout", number: 2, conclusion: "success" },
    { name: "Run API tests", number: 6, conclusion: "cancelled" },
  ],
};

const codeFailureJob = {
  name: "api-tests",
  conclusion: "failure",
  steps: [
    { name: "Set up job", number: 1, conclusion: "success" },
    { name: "Checkout", number: 2, conclusion: "success" },
    { name: "Run API tests", number: 6, conclusion: "failure" },
  ],
};

function makeRun(overrides = {}) {
  return {
    id: 31119232391,
    name: "CI",
    workflow_id: 241114608,
    event: "pull_request",
    conclusion: "failure",
    run_attempt: 1,
    head_branch: "claude/next-steps-il3331",
    head_sha: "8ee686f1c7ca5acee67abf56f7c7168a438b0704",
    head_repository: { owner: { login: "pdcarlson" } },
    created_at: "2026-08-06T16:16:24Z",
    html_url: "https://github.com/pdcarlson/Frapp/actions/runs/31119232391",
    pull_requests: [
      {
        number: 659,
        head: { ref: "claude/next-steps-il3331", sha: "8ee686f1c7ca5acee67abf56f7c7168a438b0704" },
      },
    ],
    ...overrides,
  };
}

import { makeFetchMock, quiet } from "./helpers.mjs";

// ── jobFailedInRealStep ─────────────────────────────────────────────────────

test("setup-only failure is not a real-step failure (outage signature)", () => {
  assert.equal(jobFailedInRealStep(outageSecretScanJob), false);
});

test("a failed repo step is a real-step failure", () => {
  assert.equal(jobFailedInRealStep(codeFailureJob), true);
});

test("a job with no steps is not a real-step failure", () => {
  assert.equal(jobFailedInRealStep({ conclusion: "failure" }), false);
});

// ── classifyRun ─────────────────────────────────────────────────────────────

test("outage-shaped failure classifies as infra and re-runs", () => {
  const result = classifyRun({
    run: makeRun(),
    jobs: [outageSecretScanJob, outageCancelledJob],
  });
  assert.equal(result.verdict, "infra-failure");
  assert.equal(result.shouldRerun, true);
  assert.equal(result.shouldComment, true);
});

test("real test failure classifies as code, never re-runs, and stays silent", () => {
  const result = classifyRun({ run: makeRun(), jobs: [codeFailureJob] });
  assert.equal(result.verdict, "code-failure");
  assert.equal(result.shouldRerun, false);
  // `failure` is the one conclusion the PR-activity webhook has always
  // delivered, so a wake comment here only ever restated it.
  assert.equal(result.shouldComment, false);
});

test("mixed real + setup failures count as code failure", () => {
  const result = classifyRun({
    run: makeRun(),
    jobs: [outageSecretScanJob, codeFailureJob],
  });
  assert.equal(result.verdict, "code-failure");
  assert.equal(result.shouldRerun, false);
});

test("jobs API error on a failure fails closed: no infra verdict, no re-run", () => {
  const result = classifyRun({ run: makeRun(), jobs: null });
  assert.equal(result.verdict, "unclassified-failure");
  assert.equal(result.shouldRerun, false);
  // Still a `failure` conclusion, so still the webhook's to deliver.
  assert.equal(result.shouldComment, false);
});

test("a newer run silences everything, even failures", () => {
  const result = classifyRun({ run: makeRun(), jobs: [codeFailureJob], hasNewerRun: true });
  assert.equal(result.verdict, "superseded");
  assert.equal(result.shouldRerun, false);
  assert.equal(result.shouldComment, false);
});

test("cancelled with no job ever started is infra and re-runs", () => {
  const result = classifyRun({
    run: makeRun({ conclusion: "cancelled" }),
    jobs: [outageCancelledJob],
  });
  assert.equal(result.verdict, "infra-failure");
  assert.equal(result.shouldRerun, true);
});

test("cancelled after a job started is treated as deliberate: no re-run", () => {
  const result = classifyRun({
    run: makeRun({ conclusion: "cancelled" }),
    jobs: [startedThenCancelledJob, outageCancelledJob],
  });
  assert.equal(result.verdict, "cancelled");
  assert.equal(result.shouldRerun, false);
  assert.equal(result.shouldComment, true);
});

test("cancelled with unknown freshness fails closed: no re-run", () => {
  const result = classifyRun({
    run: makeRun({ conclusion: "cancelled" }),
    jobs: [outageCancelledJob],
    hasNewerRun: null,
  });
  assert.equal(result.verdict, "cancelled");
  assert.equal(result.shouldRerun, false);
  assert.equal(result.shouldComment, true);
});

test("cancelled with unknown jobs fails closed: no re-run", () => {
  const result = classifyRun({
    run: makeRun({ conclusion: "cancelled" }),
    jobs: null,
  });
  assert.equal(result.verdict, "cancelled");
  assert.equal(result.shouldRerun, false);
});

test("timed_out is infra and re-runs", () => {
  const result = classifyRun({ run: makeRun({ conclusion: "timed_out" }) });
  assert.equal(result.verdict, "infra-failure");
  assert.equal(result.shouldRerun, true);
});

test("attempt cap stops re-runs but still comments", () => {
  const result = classifyRun({
    run: makeRun({ run_attempt: MAX_RUN_ATTEMPTS }),
    jobs: [outageSecretScanJob],
  });
  assert.equal(result.verdict, "infra-failure");
  assert.equal(result.shouldRerun, false);
  assert.equal(result.shouldComment, true);
});

test("success stays silent and never re-runs", () => {
  const result = classifyRun({ run: makeRun({ conclusion: "success" }) });
  assert.equal(result.verdict, "success");
  assert.equal(result.shouldRerun, false);
  // The webhook delivers successful check-suite rollups. Silence here is not
  // inaction: processCompletedRun still clears the stale wake (see below).
  assert.equal(result.shouldComment, false);
});

test("skipped and action_required stay fully silent", () => {
  for (const conclusion of ["skipped", "action_required"]) {
    const result = classifyRun({ run: makeRun({ conclusion }) });
    assert.equal(result.verdict, "ignored");
    assert.equal(result.shouldComment, false);
  }
});

// ── buildWakeComment ────────────────────────────────────────────────────────

test("wake comment carries the per-workflow marker, conclusion, and rerun status", () => {
  const body = buildWakeComment({
    run: makeRun(),
    verdict: "infra-failure",
    reason: "setup died",
    // A REQUEUED infra failure never reaches this builder — processCompletedRun
    // suppresses the comment entirely, because the fresh attempt's own
    // completion is the wake. The reachable shape is a re-queue that failed.
    rerunResult: { requeued: false, error: "HTTP 503" },
  });
  assert.ok(body.startsWith(wakeMarkerFor("CI")));
  assert.ok(!body.includes(wakeMarkerFor("Links")));
  assert.match(body, /attempt 1: \*\*failure\*\* \(infra-failure\)/);
  assert.match(body, /Re-queue attempt failed \(HTTP 503\)/);
});

test("capped infra comment says not to blind-retry", () => {
  const body = buildWakeComment({
    run: makeRun({ run_attempt: MAX_RUN_ATTEMPTS }),
    verdict: "infra-failure",
    reason: "setup died",
    rerunResult: null,
  });
  assert.match(body, /Attempt cap \(3\) reached/);
});

// ── requeueRun ──────────────────────────────────────────────────────────────

test("requeue prefers rerun-failed-jobs", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "POST", path: "/rerun-failed-jobs", status: 201, body: {} },
  ]);
  const result = await requeueRun({ token: "t", repo: "o/r", run: makeRun(), fetchImpl });
  assert.deepEqual(result, { requeued: true, mode: "rerun-failed-jobs" });
  assert.equal(calls.length, 1);
});

test("requeue falls back to plain rerun (e.g. fully-cancelled run)", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "POST", path: "/rerun-failed-jobs", status: 422, body: { message: "no failed jobs" } },
    { method: "POST", path: "/rerun", status: 201, body: {} },
  ]);
  const result = await requeueRun({ token: "t", repo: "o/r", run: makeRun(), fetchImpl });
  assert.deepEqual(result, { requeued: true, mode: "rerun" });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith("/rerun"));
});

// ── findOpenPrNumber ────────────────────────────────────────────────────────

test("open-PR lookup is authoritative: a merged PR gets no wake", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/pulls?head=", body: [] },
  ]);
  const result = await findOpenPrNumber({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun(),
    fetchImpl,
  });
  assert.equal(result, null);
});

test("fork PRs resolve via the head repo owner", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/pulls?head=forkowner:", body: [{ number: 7 }] },
  ]);
  const result = await findOpenPrNumber({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun({ head_repository: { owner: { login: "forkowner" } }, pull_requests: [] }),
    fetchImpl,
  });
  assert.equal(result, 7);
  assert.ok(calls[0].url.includes("state=open"));
});

test("payload PR number is only a fallback for API errors", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/pulls?head=", status: 500, body: {} },
  ]);
  const result = await findOpenPrNumber({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun(),
    fetchImpl,
  });
  assert.equal(result, 659);
});

// ── upsertWakeComment ───────────────────────────────────────────────────────

test("upsert deletes only this workflow's stale markers, then creates", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/issues/659/comments",
      body: [
        { id: 1, body: `${wakeMarkerFor("CI")}\nold CI wake` },
        { id: 2, body: "human comment" },
        { id: 3, body: `${wakeMarkerFor("Links")}\nLinks wake — must survive` },
        { id: 4, body: `${wakeMarkerFor("CI")}\nolder stray CI wake` },
      ],
    },
    { method: "DELETE", path: "/issues/comments/", status: 204, body: {} },
    { method: "POST", path: "/issues/659/comments", status: 201, body: {} },
  ]);
  const result = await upsertWakeComment({
    token: "t",
    repo: "o/r",
    prNumber: 659,
    marker: wakeMarkerFor("CI"),
    body: `${wakeMarkerFor("CI")}\nnew wake`,
    fetchImpl,
  });
  assert.equal(result.posted, true);
  const deletes = calls.filter((c) => c.method === "DELETE");
  assert.deepEqual(
    deletes.map((c) => c.url.split("/").pop()),
    ["1", "4"],
    "deletes exactly the two CI markers, never the Links one",
  );
  const creates = calls.filter((c) => c.method === "POST");
  assert.equal(creates.length, 1);
});

test("upsert collects stale ids across pages before deleting (no shift-skip)", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: "human" }));
  page1[94] = { id: 95, body: `${wakeMarkerFor("CI")}\nstale A` };
  const page2 = [{ id: 101, body: `${wakeMarkerFor("CI")}\nstale B` }];
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "&page=1", body: page1 },
    { method: "GET", path: "&page=2", body: page2 },
    { method: "DELETE", path: "/issues/comments/", status: 204, body: {} },
    { method: "POST", path: "/issues/659/comments", status: 201, body: {} },
  ]);
  await upsertWakeComment({
    token: "t",
    repo: "o/r",
    prNumber: 659,
    marker: wakeMarkerFor("CI"),
    body: "new",
    fetchImpl,
  });
  const deletes = calls.filter((c) => c.method === "DELETE");
  assert.deepEqual(deletes.map((c) => c.url.split("/").pop()), ["95", "101"]);
  const firstDeleteIndex = calls.findIndex((c) => c.method === "DELETE");
  const lastGetPageIndex = calls.reduce(
    (acc, c, i) => (c.method === "GET" && c.url.includes("page=") ? i : acc),
    -1,
  );
  assert.ok(lastGetPageIndex < firstDeleteIndex, "all pages scanned before any delete");
});

// ── processCompletedRun (end to end with mocked API) ────────────────────────

test("outage flow: classify infra, requeue, clear the stale wake, stay silent", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/actions/workflows/241114608/runs",
      body: { workflow_runs: [{ id: 31119232391, created_at: "2026-08-06T16:16:24Z" }] },
    },
    {
      method: "GET",
      path: "/actions/runs/31119232391/jobs",
      body: { jobs: [outageSecretScanJob, outageCancelledJob] },
    },
    { method: "POST", path: "/rerun-failed-jobs", status: 201, body: {} },
    { method: "GET", path: "/pulls?head=", body: [{ number: 659 }] },
    { method: "GET", path: "/issues/659/comments", body: [] },
  ]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun(),
    fetchImpl,
    logger: quiet,
  });
  assert.equal(result.verdict, "infra-failure");
  assert.deepEqual(result.rerunResult, { requeued: true, mode: "rerun-failed-jobs" });
  // The re-run's own completion re-enters this function; a wake posted now
  // would carry a verdict that is obsolete before anyone reads it.
  assert.equal(result.commented, false);
  assert.ok(
    !calls.some((c) => c.method === "POST" && c.url.includes("/issues/659/comments")),
    "no wake comment while a fresh attempt is already queued",
  );
  assert.equal(result.prNumber, 659);
});

test("infra failure that could NOT be requeued still comments", async () => {
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/actions/workflows/241114608/runs",
      body: { workflow_runs: [{ id: 31119232391, created_at: "2026-08-06T16:16:24Z" }] },
    },
    {
      method: "GET",
      path: "/actions/runs/31119232391/jobs",
      body: { jobs: [outageSecretScanJob, outageCancelledJob] },
    },
    { method: "POST", path: "/rerun-failed-jobs", status: 500, body: {} },
    { method: "POST", path: "/rerun", status: 500, body: {} },
    { method: "GET", path: "/pulls?head=", body: [{ number: 659 }] },
    { method: "GET", path: "/issues/659/comments", body: [] },
    { method: "POST", path: "/issues/659/comments", status: 201, body: {} },
  ]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun(),
    fetchImpl,
    logger: quiet,
  });
  assert.equal(result.verdict, "infra-failure");
  assert.equal(result.rerunResult.requeued, false);
  // Nothing else is going to say this: the webhook fired on the failure, but
  // only this watchdog knows the automatic retry is not coming.
  assert.equal(result.commented, true);
});

test("superseded runs short-circuit: no jobs fetch, no writes", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/actions/workflows/241114608/runs",
      body: {
        workflow_runs: [
          { id: 31119232391, created_at: "2026-08-06T16:16:24Z" },
          { id: 99999999999, created_at: "2026-08-06T17:00:00Z" },
        ],
      },
    },
  ]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun(),
    fetchImpl,
    logger: quiet,
  });
  assert.equal(result.verdict, "superseded");
  assert.equal(result.commented, false);
  assert.equal(calls.length, 1, "exactly one API call: the freshness check");
});

test("runs-API error on a code failure stays silent and never requeues", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/actions/workflows/241114608/runs", status: 503, body: {} },
    { method: "GET", path: "/actions/runs/31119232391/jobs", status: 502, body: {} },
    { method: "GET", path: "/pulls?head=", body: [{ number: 659 }] },
    { method: "GET", path: "/issues/659/comments", body: [] },
  ]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun(),
    fetchImpl,
    logger: quiet,
  });
  assert.equal(result.verdict, "unclassified-failure");
  assert.equal(result.commented, false);
  assert.ok(!calls.some((c) => c.url.includes("/rerun")), "no requeue on unknowns");
});

test("push-event runs are ignored before any API call", async () => {
  const { fetchImpl, calls } = makeFetchMock([]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun({ event: "push" }),
    fetchImpl,
    logger: quiet,
  });
  assert.equal(result.verdict, "ignored");
  assert.equal(calls.length, 0);
});

test("success flow posts nothing and fetches no jobs", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/actions/workflows/241114608/runs",
      body: { workflow_runs: [{ id: 31119232391, created_at: "2026-08-06T16:16:24Z" }] },
    },
    { method: "GET", path: "/pulls?head=", body: [{ number: 659 }] },
    { method: "GET", path: "/issues/659/comments", body: [] },
  ]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun({ conclusion: "success" }),
    fetchImpl,
    logger: quiet,
  });
  assert.equal(result.verdict, "success");
  assert.equal(result.commented, false);
  assert.ok(
    !calls.some((c) => c.method === "POST"),
    "a green run adds nothing to the thread",
  );
  assert.ok(!calls.some((c) => c.url.includes("/jobs")));
  assert.ok(!calls.some((c) => c.url.includes("/rerun")));
});

test("going green DELETES the previous red wake instead of leaving it stale", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/actions/workflows/241114608/runs",
      body: { workflow_runs: [{ id: 31119232391, created_at: "2026-08-06T16:16:24Z" }] },
    },
    { method: "GET", path: "/pulls?head=", body: [{ number: 659 }] },
    {
      method: "GET",
      path: "/issues/659/comments",
      body: [
        { id: 555, body: `${wakeMarkerFor("CI")}\n**CI wake** — cancelled` },
        { id: 556, body: "a human comment" },
      ],
    },
    { method: "DELETE", path: "/issues/comments/555", status: 204, body: {} },
  ]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun({ conclusion: "success" }),
    fetchImpl,
    logger: quiet,
  });
  assert.equal(result.verdict, "success");
  assert.equal(result.cleared, 1);
  assert.ok(
    calls.some((c) => c.method === "DELETE" && c.url.includes("/issues/comments/555")),
    "the stale wake is removed",
  );
  assert.ok(
    !calls.some((c) => c.url.includes("/issues/comments/556")),
    "a human comment is never touched",
  );
});

test("a clear that could not delete reports what it actually removed", async () => {
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/actions/workflows/241114608/runs",
      body: { workflow_runs: [{ id: 31119232391, created_at: "2026-08-06T16:16:24Z" }] },
    },
    { method: "GET", path: "/pulls?head=", body: [{ number: 659 }] },
    {
      method: "GET",
      path: "/issues/659/comments",
      body: [{ id: 555, body: `${wakeMarkerFor("CI")}\n**CI wake** — cancelled` }],
    },
    { method: "DELETE", path: "/issues/comments/555", status: 502, body: {} },
  ]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun({ conclusion: "success" }),
    fetchImpl,
    logger: quiet,
  });
  // Nothing replaces a failed delete now, so counting the attempt as a clear
  // would report a clean thread while a red wake sits on a green PR.
  assert.equal(result.cleared, 0, "an attempted delete is not a delete");
});

test("an ignored conclusion clears nothing — it carries no verdict", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/actions/workflows/241114608/runs",
      body: { workflow_runs: [{ id: 31119232391, created_at: "2026-08-06T16:16:24Z" }] },
    },
  ]);
  const result = await processCompletedRun({
    token: "t",
    repo: "pdcarlson/Frapp",
    run: makeRun({ conclusion: "skipped" }),
    fetchImpl,
    logger: quiet,
  });
  assert.equal(result.verdict, "ignored");
  assert.equal(result.commented, false);
  assert.ok(
    !calls.some((c) => c.url.includes("/comments")),
    "a skipped run must not erase a live wake it knows nothing about",
  );
});
