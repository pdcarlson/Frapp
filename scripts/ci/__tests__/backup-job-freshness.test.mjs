import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RUNS_PER_PAGE,
  candidateOlderRuns,
  evaluateJobFreshness,
  jobVerdict,
  readJobFreshness,
  verdictLogLine,
} from "../lib/backup-job-freshness.mjs";

import { makeFetchMock } from "./helpers.mjs";

// The rules both production backup-freshness watches share (#2332). Each
// watch's own suite checks that it passes its job name and windows; this one
// checks the rules, with a job name neither watch uses so no rule can lean on
// one watch's name.

const JOB = "backup-example";
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-09-25T13:15:00Z");
const STALE = 36 * HOUR;
const HUNG = 3 * HOUR;
const TIMEOUT = 30 * 60 * 1000;

function hoursAgo(hours) {
  return new Date(NOW - hours * HOUR).toISOString();
}

function run(id, { hours, status = "completed", conclusion = null, updatedHours = hours, attempt = 1 }) {
  return {
    id,
    status,
    conclusion,
    run_attempt: attempt,
    created_at: hoursAgo(hours),
    updated_at: hoursAgo(updatedHours),
  };
}

function job({ status = "completed", conclusion = "success", completedHours = 16, startedHours, name = JOB, steps } = {}) {
  return {
    name,
    status,
    conclusion: status === "completed" ? conclusion : null,
    started_at: startedHours === undefined ? null : hoursAgo(startedHours),
    completed_at: status === "completed" ? hoursAgo(completedHours) : null,
    ...(steps === undefined ? {} : { steps }),
  };
}

/** The newest run's job cancelled after `ranMs` (from `startedAt`, or its steps). */
function cancelledAfter(ranMs, { steps } = {}) {
  const completedHours = 1;
  return evaluate({
    runs: [run(2, { hours: 2, conclusion: "cancelled" }), run(1, { hours: 16.2 })],
    jobs: {
      2: [job({ conclusion: "cancelled", startedHours: completedHours + ranMs / HOUR, completedHours, steps })],
      1: [job()],
    },
  });
}

/** `jobs` maps run id to that run's jobs (or `{ status }` for an unreadable read). */
function evaluate({ runs, jobs }) {
  const jobsByRunId = new Map(
    Object.entries(jobs).map(([id, entry]) => [
      Number(id),
      Array.isArray(entry) ? { status: 200, jobs: entry } : entry,
    ]),
  );
  return evaluateJobFreshness({
    jobName: JOB,
    workflowFile: "db-backup.yml",
    staleAfterMs: STALE,
    hungAfterMs: HUNG,
    timeoutMs: TIMEOUT,
    runsStatus: 200,
    runs,
    jobsByRunId,
    now: NOW,
  });
}

describe("the newest run decides alone", () => {
  it("a success within 36h is fresh", () => {
    const verdict = evaluate({ runs: [run(1, { hours: 16.2 })], jobs: { 1: [job()] } });
    assert.deepEqual(verdict, { ok: true, fresh: true, reason: `${JOB} succeeded within 36h` });
  });

  it("a success older than 36h fails", () => {
    const verdict = evaluate({ runs: [run(1, { hours: 40.2 })], jobs: { 1: [job({ completedHours: 40 })] } });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /older than 36h/);
  });

  it("a job in flight past 3h fails, whatever an earlier run holds", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 4, status: "in_progress" }), run(1, { hours: 16.2 })],
      jobs: { 2: [job({ status: "in_progress", startedHours: 4 })], 1: [job()] },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /hung for more than 3h/);
  });

  it("a run in flight past 3h with no job yet fails", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 4, status: "queued" }), run(1, { hours: 16.2 })],
      jobs: { 2: [], 1: [job()] },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /hung/);
  });

  it("a run that ran without the job fails, whatever an earlier run holds (a renamed job must not green)", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 2, conclusion: "success" }), run(1, { hours: 16.2 })],
      jobs: { 2: [job({ name: "backup-other" })], 1: [job()] },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /job is missing/);
  });

  it("a job that ran and failed fails the same day, whatever an earlier run holds", () => {
    // A failed backup is what this alarm exists for. If an earlier success
    // covered it, an isolated failed night would never raise the P1.
    for (const conclusion of ["failure", "timed_out", "action_required"]) {
      const verdict = evaluate({
        runs: [run(2, { hours: 2, conclusion: "failure" }), run(1, { hours: 16.2 })],
        jobs: { 2: [job({ conclusion, completedHours: 1.9 })], 1: [job()] },
      });
      assert.equal(verdict.ok, false, conclusion);
      assert.match(verdict.reason, new RegExp(`concluded ${conclusion}`));
    }
  });

  it("a job its timeout stopped fails the same day, though GitHub reports it as cancelled", () => {
    // The runner has no timed-out job result: a job killed by
    // `timeout-minutes` completes as `cancelled`. Only its runtime tells it
    // from a cancelled dispatch.
    const verdict = evaluate({
      runs: [run(2, { hours: 2, conclusion: "cancelled" }), run(1, { hours: 16.2 })],
      jobs: {
        2: [job({ conclusion: "cancelled", startedHours: 1.9, completedHours: 1.4 })],
        1: [job()],
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /backup-example hit its 30-minute timeout/);
  });

  it("a job cancelled well before its timeout is not a timeout", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 2, conclusion: "cancelled" }), run(1, { hours: 16.2 })],
      jobs: {
        2: [job({ conclusion: "cancelled", startedHours: 1.9, completedHours: 1.8 })],
        1: [job()],
      },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.fresh, false);
  });

  it("counts a cancel as a timeout only from a minute under the timeout to 15 minutes past it", () => {
    const MINUTE = 60 * 1000;
    for (const [ranMs, timedOut] of [
      [TIMEOUT - 2 * MINUTE, false],
      [TIMEOUT - 30 * 1000, true],
      [TIMEOUT + 10 * MINUTE, true],
      [TIMEOUT + 20 * MINUTE, false],
    ]) {
      const verdict = cancelledAfter(ranMs);
      assert.equal(verdict.ok, !timedOut, `${ranMs / MINUTE} minutes`);
      if (timedOut) assert.match(verdict.reason, /hit its 30-minute timeout/);
    }
  });

  it("a job cancelled while it waited, with no step run, is not a timeout", () => {
    // `started_at` of a job that never reached a runner marks when it was
    // queued, so a 45-minute wait would otherwise read as a timeout.
    const verdict = cancelledAfter(45 * 60 * 1000, { steps: [] });
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /concluded cancelled/);
  });

  it("measures the runtime from the first step, not from when the job was queued", () => {
    const firstStep = { name: "Set up job", started_at: hoursAgo(1 + 10 / 60) };
    const verdict = cancelledAfter(TIMEOUT + 10 * 60 * 1000, { steps: [firstStep] });
    assert.equal(verdict.ok, true, "a 10-minute run after a 30-minute wait was cancelled early");
    const ranFull = cancelledAfter(TIMEOUT + 10 * 60 * 1000, {
      steps: [{ name: "Set up job", started_at: hoursAgo(1 + TIMEOUT / HOUR) }],
    });
    assert.equal(ranFull.ok, false);
  });

  it("a run that failed before creating any job fails as missing (a broken workflow must not green)", () => {
    for (const conclusion of ["failure", "startup_failure"]) {
      const verdict = evaluate({
        runs: [run(2, { hours: 2, conclusion }), run(1, { hours: 16.2 })],
        jobs: { 2: [], 1: [job()] },
      });
      assert.equal(verdict.ok, false, conclusion);
      assert.match(verdict.reason, /job is missing/);
    }
  });

  it("a run cancelled after other jobs started, without the job, still fails as missing", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 2, conclusion: "cancelled" }), run(1, { hours: 16.2 })],
      jobs: { 2: [job({ name: "backup-other", conclusion: "cancelled", completedHours: 1.9 })], 1: [job()] },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /job is missing/);
  });
});

describe("an earlier success backs the newest run", () => {
  const cases = [
    ["a job in flight", run(2, { hours: 1, status: "in_progress" }), [job({ status: "in_progress", startedHours: 1 })], /in flight/],
    ["a job waiting on a protection rule", run(2, { hours: 1, status: "waiting" }), [job({ status: "waiting" })], /in flight/],
    ["a queued run with no job yet", run(2, { hours: 0.5, status: "queued" }), [], /in flight/],
    ["a cancelled job", run(2, { hours: 2, conclusion: "cancelled" }), [job({ conclusion: "cancelled", completedHours: 1.9 })], /concluded cancelled/],
    ["a skipped job", run(2, { hours: 2, conclusion: "skipped" }), [job({ conclusion: "skipped", completedHours: 1.9 })], /concluded skipped/],
    ["a run cancelled before any job was created", run(2, { hours: 2, conclusion: "cancelled" }), [], /newest run was cancelled before/],
  ];

  for (const [name, newest, newestJobs, reason] of cases) {
    it(`${name}: passes, not fresh, with a success within 36h`, () => {
      const verdict = evaluate({ runs: [newest, run(1, { hours: 16.2 })], jobs: { 2: newestJobs, 1: [job()] } });
      assert.equal(verdict.ok, true);
      assert.equal(verdict.fresh, false, "a pass resting on an earlier run must never close the alert");
      assert.match(verdict.reason, reason);
      assert.match(verdict.reason, new RegExp(`an earlier ${JOB} succeeded 16h ago`));
    });

    it(`${name}: fails with no success within 36h`, () => {
      const verdict = evaluate({
        runs: [newest, run(1, { hours: 40.2 })],
        jobs: { 2: newestJobs, 1: [job({ completedHours: 40 })] },
      });
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason, /no backup-example success is within 36h/);
    });

    it(`${name}: fails with no earlier run at all`, () => {
      assert.equal(evaluate({ runs: [newest], jobs: { 2: newestJobs } }).ok, false);
    });
  }

  it("does not green a job left waiting night after night", () => {
    // Each night's run parks in `waiting`, so none holds a success, and the
    // last real success has aged out of the window.
    const verdict = evaluate({
      runs: [
        run(3, { hours: 1, status: "waiting" }),
        run(2, { hours: 25, status: "waiting" }),
        run(1, { hours: 49, updatedHours: 48.9 }),
      ],
      jobs: { 3: [job({ status: "waiting" })], 2: [job({ status: "waiting" })], 1: [job({ completedHours: 48.9 })] },
    });
    assert.equal(verdict.ok, false);
  });

  it("does not count another job's success", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 1, status: "in_progress" }), run(1, { hours: 16.2 })],
      jobs: { 2: [job({ status: "in_progress", startedHours: 1 })], 1: [job({ name: "backup-other" })] },
    });
    assert.equal(verdict.ok, false);
  });

  it("counts a success in an earlier run that is itself still in flight (its other jobs still running)", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 0.2, status: "pending" }), run(1, { hours: 0.5, status: "in_progress", updatedHours: 0.1 })],
      jobs: { 2: [], 1: [job({ completedHours: 0.3 }), job({ name: "backup-other", status: "in_progress", startedHours: 0.5 })] },
    });
    assert.equal(verdict.ok, true);
  });

  it("counts a success from re-running a run created long ago", () => {
    // A re-run keeps `created_at` and moves `updated_at`.
    const verdict = evaluate({
      runs: [run(2, { hours: 2, conclusion: "cancelled" }), run(1, { hours: 49, updatedHours: 5 })],
      jobs: { 2: [job({ conclusion: "cancelled", completedHours: 1.9 })], 1: [job({ completedHours: 5 })] },
    });
    assert.equal(verdict.ok, true);
  });

  it("fails when the last finished attempt before a cancelled run failed, whatever succeeded before that", () => {
    // Cancelling a retry must not hide the failed nightly behind yesterday's
    // success.
    const verdict = evaluate({
      runs: [run(3, { hours: 0.5, conclusion: "cancelled" }), run(2, { hours: 6 }), run(1, { hours: 30.5 })],
      jobs: { 3: [], 2: [job({ conclusion: "failure", completedHours: 1.2 })], 1: [job({ completedHours: 30.3 })] },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /and before it backup-example concluded failure/);
  });

  it("fails when the last finished attempt before an in-flight run timed out", () => {
    const verdict = evaluate({
      runs: [run(3, { hours: 0.5, status: "pending" }), run(2, { hours: 6 }), run(1, { hours: 30.5 })],
      jobs: {
        3: [],
        2: [job({ conclusion: "cancelled", startedHours: 5.9, completedHours: 5.4 })],
        1: [job({ completedHours: 30.3 })],
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /hit its 30-minute timeout/);
  });

  it("passes over earlier runs where the job didn't finish an attempt, to the success behind them", () => {
    const verdict = evaluate({
      runs: [run(4, { hours: 0.5, conclusion: "cancelled" }), run(3, { hours: 3, conclusion: "cancelled" }), run(2, { hours: 5, status: "in_progress" }), run(1, { hours: 16.2 })],
      jobs: {
        4: [],
        3: [job({ conclusion: "cancelled", startedHours: 2.9, completedHours: 2.8 })],
        2: [job({ status: "in_progress", startedHours: 4.9 })],
        1: [job()],
      },
    });
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /succeeded 16h ago/);
  });

  it("fails a re-run whose job was cancelled or skipped, since the listing hides the earlier attempt", () => {
    // `filter=latest` shows attempt 2 only: attempt 1 may have failed.
    for (const conclusion of ["cancelled", "skipped"]) {
      const verdict = evaluate({
        runs: [run(2, { hours: 2, attempt: 2 }), run(1, { hours: 25 })],
        jobs: {
          2: [job({ conclusion, startedHours: 0.5, completedHours: 0.48 })],
          1: [job({ completedHours: 24.8 })],
        },
      });
      assert.equal(verdict.ok, false, conclusion);
      assert.match(verdict.reason, new RegExp(`concluded ${conclusion} on re-run attempt 2`));
    }
  });

  it("stops the walk at an earlier re-run whose job was cancelled", () => {
    const verdict = evaluate({
      runs: [run(3, { hours: 0.5, status: "in_progress" }), run(2, { hours: 6, attempt: 3 }), run(1, { hours: 25 })],
      jobs: {
        3: [job({ status: "in_progress", startedHours: 0.4 })],
        2: [job({ conclusion: "cancelled", startedHours: 1, completedHours: 0.98 })],
        1: [job({ completedHours: 24.8 })],
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /and before it backup-example concluded cancelled on re-run attempt 3/);
  });

  it("passes over an earlier run whose job was skipped", () => {
    const verdict = evaluate({
      runs: [run(3, { hours: 0.5, status: "in_progress" }), run(2, { hours: 6 }), run(1, { hours: 25 })],
      jobs: {
        3: [job({ status: "in_progress", startedHours: 0.4 })],
        2: [job({ conclusion: "skipped", completedHours: 5.9 })],
        1: [job({ completedHours: 24.8 })],
      },
    });
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /succeeded 25h ago/);
  });

  it("judges only the first finished attempt it reaches: an old success there is FAIL, even with a newer one behind it", () => {
    // Run 2's job succeeded 40h ago, but another job's re-run moved the run's
    // `updated_at` into the window. Run 1 was created earlier and its job was
    // re-run to success 2h ago. The walk stops at run 2.
    const verdict = evaluate({
      runs: [run(3, { hours: 0.5, status: "in_progress" }), run(2, { hours: 41, updatedHours: 3 }), run(1, { hours: 50, updatedHours: 2, attempt: 2 })],
      jobs: {
        3: [job({ status: "in_progress", startedHours: 0.4 })],
        2: [job({ completedHours: 40 }), job({ name: "backup-other", completedHours: 3 })],
        1: [job({ completedHours: 2 })],
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no backup-example success is within 36h/);
  });

  it("does not count an old success in a run updated recently by other jobs", () => {
    // Re-running a run's failed jobs moves its `updated_at` into the window,
    // and `filter=latest` still lists the watched job's old success.
    const verdict = evaluate({
      runs: [run(2, { hours: 2, conclusion: "cancelled" }), run(1, { hours: 49, updatedHours: 5 })],
      jobs: {
        2: [],
        1: [job({ completedHours: 48.9 }), job({ name: "backup-other", completedHours: 5 })],
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no backup-example success is within 36h/);
  });

  it("counts a success whose run queued for hours before the job started", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 2, conclusion: "cancelled" }), run(1, { hours: 45, updatedHours: 30 })],
      jobs: { 2: [], 1: [job({ completedHours: 30 })] },
    });
    assert.equal(verdict.ok, true);
  });

  it("fails when an earlier run's jobs are unreadable", () => {
    const verdict = evaluate({
      runs: [run(2, { hours: 1, status: "in_progress" }), run(1, { hours: 16.2 })],
      jobs: { 2: [job({ status: "in_progress", startedHours: 1 })], 1: { status: 502, jobs: null } },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /earlier run unreadable \(HTTP 502\)/);
  });
});

describe("candidateOlderRuns", () => {
  it("keeps every earlier run updated within the window, in flight or not, newest first", () => {
    const runs = [
      run(1, { hours: 49, updatedHours: 40 }),
      run(4, { hours: 1 }),
      run(3, { hours: 3, status: "in_progress" }),
      run(2, { hours: 45, updatedHours: 20 }),
    ];
    assert.deepEqual(
      candidateOlderRuns({ runs, staleAfterMs: STALE, now: NOW }).map((r) => r.id),
      [3, 2],
    );
  });
});

describe("readJobFreshness", () => {
  function read(routes) {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: "/runs?", body: { workflow_runs: routes.runs } },
      ...Object.entries(routes.jobs).map(([id, body]) => ({
        method: "GET",
        path: `/runs/${id}/jobs`,
        status: body.status ?? 200,
        body: { jobs: body.jobs ?? body },
      })),
    ]);
    const get = async (path) => {
      const response = await fetchImpl(path);
      return { status: response.status, data: JSON.parse(await response.text()) };
    };
    return readJobFreshness({
      jobName: JOB,
      workflowFile: "db-backup.yml",
      staleAfterMs: STALE,
      hungAfterMs: HUNG,
      timeoutMs: TIMEOUT,
      runsPath: "/runs?branch=main",
      jobsPath: (id) => `/runs/${id}/jobs`,
      get,
      now: NOW,
    }).then((verdict) => ({ verdict, reads: calls.map((c) => c.url.match(/runs\/(\d+)/)?.[1] ?? "runs") }));
  }

  const cancelled = run(9, { hours: 2, conclusion: "cancelled" });

  it("reads no earlier run when the newest run decides alone", async () => {
    for (const newest of [
      { run: run(9, { hours: 16.2 }), jobs: [job()] },
      { run: run(9, { hours: 4, status: "in_progress" }), jobs: [job({ status: "in_progress", startedHours: 4 })] },
      { run: run(9, { hours: 2, conclusion: "success" }), jobs: [job({ name: "backup-other" })] },
    ]) {
      const { reads } = await read({
        runs: [newest.run, run(8, { hours: 20 })],
        jobs: { 9: newest.jobs, 8: [job({ completedHours: 20 })] },
      });
      assert.deepEqual(reads, ["runs", "9"]);
    }
  });

  it("reads earlier runs to the first finished attempt, and stops there even when it failed", async () => {
    const { verdict, reads } = await read({
      runs: [cancelled, run(8, { hours: 16.2 }), run(7, { hours: 20 }), run(6, { hours: 30 })],
      jobs: {
        9: [],
        8: [job({ conclusion: "failure", completedHours: 16 })],
        7: [job({ completedHours: 20 })],
        6: [job({ completedHours: 30 })],
      },
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(reads, ["runs", "9", "8"]);
  });

  it("stops at an unreadable earlier run, and fails", async () => {
    const { verdict, reads } = await read({
      runs: [cancelled, run(8, { hours: 16.2 }), run(7, { hours: 20 })],
      jobs: { 9: [], 8: { status: 502, jobs: null }, 7: [job({ completedHours: 20 })] },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /HTTP 502/);
    assert.deepEqual(reads, ["runs", "9", "8"]);
  });

  it("never reads a run not updated within the window", async () => {
    const { verdict, reads } = await read({
      runs: [cancelled, run(8, { hours: 49, updatedHours: 48.9 })],
      jobs: { 9: [], 8: [job({ completedHours: 48.9 })] },
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(reads, ["runs", "9"]);
  });
});

describe("what the scripts share besides the verdict", () => {
  it("prints a fresh pass green, a backed pass as a warning, and a failure as an error", () => {
    assert.equal(verdictLogLine(jobVerdict(true, true, "fine")), "✅ fine");
    assert.equal(verdictLogLine(jobVerdict(true, false, "backed")), "::warning::backed");
    assert.equal(verdictLogLine(jobVerdict(false, false, "broken")), "::error::broken");
  });

  it("lists 30 runs, so a burst of dispatches can't easily hide the last success", () => {
    assert.equal(RUNS_PER_PAGE, 30);
  });
});
