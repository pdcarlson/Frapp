import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  candidateOlderRuns,
  evaluateJobFreshness,
  readJobFreshness,
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

function hoursAgo(hours) {
  return new Date(NOW - hours * HOUR).toISOString();
}

function run(id, { hours, status = "completed", conclusion = null, updatedHours = hours }) {
  return {
    id,
    status,
    conclusion,
    created_at: hoursAgo(hours),
    updated_at: hoursAgo(updatedHours),
  };
}

function job({ status = "completed", conclusion = "success", completedHours = 16, startedHours, name = JOB } = {}) {
  return {
    name,
    status,
    conclusion: status === "completed" ? conclusion : null,
    started_at: startedHours === undefined ? null : hoursAgo(startedHours),
    completed_at: status === "completed" ? hoursAgo(completedHours) : null,
  };
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
    ["a failed job", run(2, { hours: 2, conclusion: "failure" }), [job({ conclusion: "failure", completedHours: 1.9 })], /concluded failure/],
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
      runs: [run(2, { hours: 2, conclusion: "failure" }), run(1, { hours: 49, updatedHours: 5 })],
      jobs: { 2: [job({ conclusion: "failure", completedHours: 1.9 })], 1: [job({ completedHours: 5 })] },
    });
    assert.equal(verdict.ok, true);
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

  it("reads earlier runs until one holds a success within the window, past failures", async () => {
    const { verdict, reads } = await read({
      runs: [cancelled, run(8, { hours: 16.2 }), run(7, { hours: 20 }), run(6, { hours: 30 })],
      jobs: {
        9: [],
        8: [job({ conclusion: "failure", completedHours: 16 })],
        7: [job({ completedHours: 20 })],
        6: [job({ completedHours: 30 })],
      },
    });
    assert.equal(verdict.ok, true);
    assert.deepEqual(reads, ["runs", "9", "8", "7"]);
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
