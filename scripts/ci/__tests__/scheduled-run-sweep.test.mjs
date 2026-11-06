import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT,
  CANCELLED_STREAK_ALERT_AT,
  STUCK_AFTER_MINUTES,
  WATCHED_WORKFLOWS,
  buildIssueBody,
  cancelledStreak,
  exitCodeFor,
  main,
  markerIn,
  problemsIn,
  runSweep,
  stuckRuns,
  sweepMarker,
  sweepWorkflow,
  updateAlert,
} from "../scheduled-run-sweep.mjs";
import { ALERT_LOOKUP_LABEL } from "../lib/alert-issue.mjs";
import { makeFetchMock } from "./helpers.mjs";
import { workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const WORKFLOW = join(WORKFLOWS_DIR, "scheduled-run-sweep.yml");
const REPO = "pdcarlson/Frapp";
const NOW = new Date("2026-11-06T12:50:00Z");

function hoursAgo(hours) {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function run(id, { status = "completed", conclusion = "success", startedHoursAgo = 1 } = {}) {
  const stamp = hoursAgo(startedHoursAgo);
  return {
    id,
    status,
    conclusion: status === "completed" ? conclusion : null,
    created_at: stamp,
    run_started_at: stamp,
    html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  };
}

const ZOMBIE = run(37337018741, { status: "in_progress", startedHoursAgo: 24 * 30 });

/** GitHub routes for one workflow, plus the alert lookup and writes. */
function github({
  workflow = "production-guardrails.yml",
  inProgress = [],
  queued = [],
  scheduled = [],
  readStatus = 200,
  cancelStatus = 202,
  issues = [],
  lookupStatus = 200,
} = {}) {
  const runs = (list) => ({ total_count: list.length, workflow_runs: list });
  return makeFetchMock([
    { method: "GET", path: `/actions/workflows/${workflow}/runs?status=in_progress`, status: readStatus, body: runs(inProgress) },
    { method: "GET", path: `/actions/workflows/${workflow}/runs?status=queued`, body: runs(queued) },
    { method: "GET", path: `/actions/workflows/${workflow}/runs?event=schedule`, body: runs(scheduled) },
    { method: "POST", path: "/force-cancel", status: cancelStatus, body: {} },
    { method: "GET", path: `/repos/${REPO}/issues?state=all`, status: lookupStatus, body: issues },
    { method: "POST", path: `/repos/${REPO}/issues/`, status: 201, body: { id: 1 } },
    { method: "POST", path: `/repos/${REPO}/issues`, status: 201, body: { number: 99, assignees: [{ login: "pdcarlson" }] } },
    { method: "PATCH", path: `/repos/${REPO}/issues/`, body: { number: 42, assignees: [{ login: "pdcarlson" }] } },
  ]);
}

function openAlert(number, body = "") {
  return { number, title: ALERT.title, state: "open", body, labels: [{ name: ALERT_LOOKUP_LABEL }], assignees: [] };
}

function cancels(calls) {
  return calls.filter((call) => call.method === "POST" && call.url.endsWith("/force-cancel"));
}

function writes(calls) {
  return calls.filter((call) => call.method !== "GET");
}

function okResult(workflow, extra = {}) {
  return { workflow, ok: true, cleared: [], uncancellable: [], streak: [], ...extra };
}

const STREAK = [1, 2, 3].map((id) => run(id, { conclusion: "cancelled", startedHoursAgo: id * 24 }));

describe("stuckRuns", () => {
  it("is a run still in progress or queued past the limit, oldest first", () => {
    const old = run(1, { status: "in_progress", startedHoursAgo: 7 });
    const older = run(2, { status: "queued", startedHoursAgo: 30 });
    const young = run(3, { status: "in_progress", startedHoursAgo: 5 });
    assert.deepEqual(
      stuckRuns([old, young, older], NOW).map((r) => r.id),
      [2, 1],
    );
  });

  it("counts a run exactly at the limit, and never a pending one, which is waiting for the group", () => {
    const atLimit = run(1, { status: "in_progress", startedHoursAgo: STUCK_AFTER_MINUTES / 60 });
    const pending = run(2, { status: "pending", startedHoursAgo: 48 });
    assert.deepEqual(
      stuckRuns([atLimit, pending], NOW).map((r) => r.id),
      [1],
    );
  });

  it("skips a run with no readable start time rather than guessing its age", () => {
    assert.deepEqual(stuckRuns([{ id: 1, status: "in_progress" }], NOW), []);
  });
});

describe("cancelledStreak", () => {
  it("is the newest completed runs that were cancelled, up to the first that wasn't", () => {
    const list = [
      run(4, { status: "pending", startedHoursAgo: 0 }),
      run(3, { conclusion: "cancelled", startedHoursAgo: 24 }),
      run(2, { conclusion: "cancelled", startedHoursAgo: 48 }),
      run(1, { conclusion: "success", startedHoursAgo: 72 }),
      run(0, { conclusion: "cancelled", startedHoursAgo: 96 }),
    ];
    assert.deepEqual(
      cancelledStreak(list).map((r) => r.id),
      [3, 2],
    );
  });

  it("orders by creation itself, and is empty when the newest completed run wasn't cancelled", () => {
    const list = [run(1, { conclusion: "cancelled", startedHoursAgo: 48 }), run(2, { conclusion: "failure", startedHoursAgo: 24 })];
    assert.deepEqual(cancelledStreak(list), []);
  });
});

describe("sweepWorkflow", () => {
  it("force-cancels a run holding the group past the limit, and leaves a young one", async () => {
    const young = run(5, { status: "in_progress", startedHoursAgo: 1 });
    const { fetchImpl, calls } = github({ inProgress: [ZOMBIE, young] });
    const result = await sweepWorkflow({ token: "t", repo: REPO, fetchImpl, workflow: "production-guardrails.yml", now: NOW });
    assert.equal(result.ok, true);
    assert.deepEqual(result.cleared.map((r) => r.id), [ZOMBIE.id]);
    assert.deepEqual(
      cancels(calls).map((call) => call.url),
      [`https://api.github.com/repos/${REPO}/actions/runs/${ZOMBIE.id}/force-cancel`],
    );
  });

  it("also clears a run queued past the limit: queued already holds the group", async () => {
    const stale = run(6, { status: "queued", startedHoursAgo: 9 });
    const { fetchImpl } = github({ queued: [stale] });
    const result = await sweepWorkflow({ token: "t", repo: REPO, fetchImpl, workflow: "production-guardrails.yml", now: NOW });
    assert.deepEqual(result.cleared.map((r) => r.id), [6]);
  });

  it("counts a 409 as cleared: the run finished in the meantime", async () => {
    const { fetchImpl } = github({ inProgress: [ZOMBIE], cancelStatus: 409 });
    const result = await sweepWorkflow({ token: "t", repo: REPO, fetchImpl, workflow: "production-guardrails.yml", now: NOW });
    assert.deepEqual(result.cleared.map((r) => r.id), [ZOMBIE.id]);
    assert.deepEqual(result.uncancellable, []);
  });

  it("reports a run it couldn't cancel", async () => {
    const { fetchImpl } = github({ inProgress: [ZOMBIE], cancelStatus: 403 });
    const result = await sweepWorkflow({ token: "t", repo: REPO, fetchImpl, workflow: "production-guardrails.yml", now: NOW });
    assert.deepEqual(result.cleared, []);
    assert.deepEqual(result.uncancellable, [{ run: ZOMBIE, status: 403 }]);
  });

  it("cancels nothing when a read failed", async () => {
    const { fetchImpl, calls } = github({ readStatus: 404, queued: [run(6, { status: "queued", startedHoursAgo: 9 })] });
    const result = await sweepWorkflow({ token: "t", repo: REPO, fetchImpl, workflow: "production-guardrails.yml", now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.deepEqual(cancels(calls), []);
  });

  it("reads the cancelled streak from scheduled runs only", async () => {
    const { fetchImpl, calls } = github({ scheduled: STREAK });
    const result = await sweepWorkflow({ token: "t", repo: REPO, fetchImpl, workflow: "production-guardrails.yml", now: NOW });
    assert.deepEqual(result.streak.map((r) => r.id), [1, 2, 3]);
    assert.ok(calls.some((call) => call.url.includes("runs?event=schedule&status=completed")));
  });
});

describe("problemsIn and the marker", () => {
  it("raises for a streak at the threshold, not below it, and for every run that couldn't be cancelled", () => {
    const below = okResult("a.yml", { streak: STREAK.slice(0, CANCELLED_STREAK_ALERT_AT - 1) });
    const at = okResult("b.yml", { streak: STREAK.slice(0, CANCELLED_STREAK_ALERT_AT) });
    const stuck = okResult("c.yml", { uncancellable: [{ run: ZOMBIE, status: 500 }] });
    const problems = problemsIn([stuck, below, at]);
    assert.deepEqual(
      problems.map((p) => [p.kind, p.workflow]),
      [
        ["streak", "b.yml"],
        ["stuck", "c.yml"],
      ],
    );
    assert.equal(sweepMarker(problems), `<!-- scheduled-run-sweep: streak:b.yml,stuck:${ZOMBIE.id} -->`);
  });

  it("keys a streak by workflow, so a streak growing by a run is no change", () => {
    const three = problemsIn([okResult("b.yml", { streak: STREAK })]);
    const four = problemsIn([okResult("b.yml", { streak: [...STREAK, run(4, { conclusion: "cancelled" })] })]);
    assert.equal(sweepMarker(three), sweepMarker(four));
  });

  it("reads its marker back from a body the web UI saved with CRLF", () => {
    const problems = problemsIn([okResult("b.yml", { streak: STREAK })]);
    const body = buildIssueBody({ problems, runUrl: "" }).replaceAll("\n", "\r\n");
    assert.equal(markerIn(body), sweepMarker(problems));
  });
});

describe("updateAlert", () => {
  const frozen = [okResult("staging-conformance.yml", { streak: STREAK })];

  it("files the alert, naming the workflow and the newest cancelled run", async () => {
    const { fetchImpl, calls } = github();
    const result = await updateAlert({ token: "t", repo: REPO, fetchImpl, results: frozen, runUrl: "https://run" });
    assert.equal(result.action, "created");
    const created = JSON.parse(writes(calls)[0].body);
    assert.equal(created.title, ALERT.title);
    assert.match(created.body, /`staging-conformance\.yml`: its last 3 scheduled runs were cancelled/);
    assert.match(created.body, /actions\/runs\/1\)/);
    assert.match(created.body, /<!-- scheduled-run-sweep: streak:staging-conformance\.yml -->/);
  });

  it("stays quiet when the open alert already names exactly these problems", async () => {
    const body = buildIssueBody({ problems: problemsIn(frozen), runUrl: "" });
    const { fetchImpl, calls } = github({ issues: [openAlert(42, body)] });
    const result = await updateAlert({ token: "t", repo: REPO, fetchImpl, results: frozen });
    assert.deepEqual(result, { action: "unchanged", issueNumber: 42 });
    assert.deepEqual(writes(calls), []);
  });

  it("comments and rewrites the body when what is frozen changes", async () => {
    const earlier = buildIssueBody({ problems: problemsIn([okResult("other.yml", { streak: STREAK })]), runUrl: "" });
    const { fetchImpl, calls } = github({ issues: [openAlert(42, earlier)] });
    const result = await updateAlert({ token: "t", repo: REPO, fetchImpl, results: frozen });
    assert.equal(result.action, "commented");
    const patch = writes(calls).find((call) => call.method === "PATCH");
    assert.match(JSON.parse(patch.body).body, /streak:staging-conformance\.yml/);
  });

  it("closes the alert when nothing is frozen", async () => {
    const { fetchImpl } = github({ issues: [openAlert(42)] });
    const result = await updateAlert({ token: "t", repo: REPO, fetchImpl, results: [okResult("a.yml")] });
    assert.equal(result.action, "closed");
  });

  it("closes nothing, and doesn't even look, when a workflow's runs couldn't be read", async () => {
    const { fetchImpl, calls } = github({ issues: [openAlert(42)] });
    const result = await updateAlert({
      token: "t",
      repo: REPO,
      fetchImpl,
      results: [okResult("a.yml"), { workflow: "b.yml", ok: false, status: 500, cleared: [], uncancellable: [], streak: [] }],
    });
    assert.deepEqual(result, { action: "unread" });
    assert.deepEqual(calls, []);
  });

  it("writes nothing when the alert lookup fails", async () => {
    const { fetchImpl, calls } = github({ lookupStatus: 500 });
    const result = await updateAlert({ token: "t", repo: REPO, fetchImpl, results: frozen });
    assert.deepEqual(result, { action: "unread" });
    assert.deepEqual(writes(calls), []);
  });
});

describe("runSweep", () => {
  it("clears the incident's zombie and stays green: a cleared run is a warning, not an alert", async () => {
    const { fetchImpl, calls } = github({ inProgress: [ZOMBIE] });
    const lines = [];
    let summary = "";
    const outcome = await runSweep({
      token: "t",
      repo: REPO,
      fetchImpl,
      workflows: ["production-guardrails.yml"],
      now: NOW,
      writeSummary: (markdown) => {
        summary = markdown;
      },
      logger: { log: (line) => lines.push(line) },
    });
    assert.equal(cancels(calls).length, 1);
    assert.equal(outcome.alert.action, "none");
    assert.equal(exitCodeFor(outcome), 0);
    assert.ok(lines.some((line) => line.startsWith("::warning::production-guardrails.yml: force-cancelled")));
    assert.match(summary, /\| `production-guardrails\.yml` \| 0 \| \[run 37337018741\]/);
  });
});

describe("exitCodeFor", () => {
  it("is 0 only with every workflow read, nothing frozen, and the alert known to be clear", () => {
    const clear = [okResult("a.yml")];
    assert.equal(exitCodeFor({ results: clear, alert: { action: "none" } }), 0);
    assert.equal(exitCodeFor({ results: clear, alert: { action: "closed" } }), 0);
    assert.equal(exitCodeFor({ results: clear, alert: { action: "failed" } }), 1);
    assert.equal(exitCodeFor({ results: clear, alert: { action: "unread" } }), 1);
    assert.equal(exitCodeFor({ results: [{ ...okResult("a.yml"), ok: false }], alert: { action: "unread" } }), 1);
    const frozen = [okResult("a.yml", { streak: STREAK })];
    assert.equal(exitCodeFor({ results: frozen, alert: { action: "unchanged" } }), 1);
  });
});

describe("main", () => {
  it("hands the sweep its token, repo and run link", async () => {
    let seen;
    const code = await main({
      env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: REPO, RUN_URL: "https://run" },
      run: async (args) => {
        seen = args;
        return { results: [], alert: { action: "none" } };
      },
    });
    assert.equal(code, 0);
    assert.deepEqual(seen, { token: "t", repo: REPO, runUrl: "https://run" });
  });
});

describe("what it watches", () => {
  const files = readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith(".yml"));
  const read = (name) => readFileSync(join(WORKFLOWS_DIR, name), "utf8").replaceAll("\r\n", "\n");

  it("is every scheduled workflow whose concurrency group never cancels a run in progress", () => {
    const freezable = files.filter((name) => {
      const code = read(name);
      return /^ {2}schedule:/m.test(code) && /^concurrency:\n(?:[ #].*\n)*? {2}cancel-in-progress: false/m.test(code);
    });
    assert.deepEqual([...WATCHED_WORKFLOWS].sort(), freezable.sort());
  });

  it("uses a stuck limit an hour past each workflow's total timeout-minutes, so a working run is never cut short", () => {
    for (const name of WATCHED_WORKFLOWS) {
      const jobs = workflowJobs(join(WORKFLOWS_DIR, name));
      const total = jobs.reduce((sum, job) => sum + Number(job.keys.get("timeout-minutes")), 0);
      assert.ok(Number.isFinite(total) && total > 0, `${name}: every job sets timeout-minutes`);
      assert.ok(total + 60 <= STUCK_AFTER_MINUTES, `${name}: ${total} minutes of jobs leaves no margin under ${STUCK_AFTER_MINUTES}`);
    }
  });
});

describe("scheduled-run-sweep.yml", () => {
  const code = readFileSync(WORKFLOW, "utf8");

  it("runs every 3 hours and on dispatch, with no concurrency group a stuck run could hold", () => {
    assert.match(code, /schedule:\n(?:\s+#[^\n]*\n)*\s+- cron: "50 \*\/3 \* \* \*"/);
    assert.match(code, /workflow_dispatch:/);
    assert.doesNotMatch(code, /^\s*concurrency:/m);
  });

  it("is not itself watched", () => {
    assert.ok(!WATCHED_WORKFLOWS.includes("scheduled-run-sweep.yml"));
  });

  it("has one job, on main only, bounded, with actions and issues as its only write scopes", () => {
    const jobs = workflowJobs(WORKFLOW);
    assert.deepEqual(jobs.map((j) => j.jobId), ["sweep"]);
    const { keys } = jobs[0];
    assert.equal(keys.get("if"), "github.ref == 'refs/heads/main'");
    assert.deepEqual(Object.fromEntries(keys.get("permissions")), { contents: "read", actions: "write", issues: "write" });
    assert.equal(keys.get("timeout-minutes"), "5");
    assert.doesNotMatch(code, /environment:/);
  });

  it("runs the sweep script, with no expression inside the run line", () => {
    const steps = workflowSteps(WORKFLOW);
    assert.deepEqual(
      steps.map((s) => s.name),
      ["Checkout", "Setup Node", "Clear stuck runs and update the alert"],
    );
    const sweep = steps.at(-1);
    assert.match(sweep.body, /run: node scripts\/ci\/scheduled-run-sweep\.mjs$/);
    assert.doesNotMatch(sweep.body, /run:[^\n]*\$\{\{/);
  });
});
