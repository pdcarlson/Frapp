import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_ISSUE_TITLE,
  HUNG_AFTER_MS,
  JOB_TIMEOUT_MS,
  PRODUCTION_JOB_NAME,
  STALE_AFTER_MS,
  WORKFLOW_FILE,
  readDumpFreshness,
  resolveActionsFallbackToken,
  resolveActionsReadToken,
  runWatchdog,
} from "../production-backup-freshness.mjs";
import { ALERT_ASSIGNEE, ALERT_LOOKUP_LABEL } from "../lib/alert-issue.mjs";
import { evaluateJobFreshness, runsNewestFirst } from "../lib/backup-job-freshness.mjs";

import { makeFetchMock } from "./helpers.mjs";
import { workflowJobs } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "production-backup-freshness.yml");
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "production-backup-freshness.mjs");
const ALERT_ROUTING = join(REPO_ROOT, "docs", "internal", "ops", "ALERT_ROUTING.md");
const AGENT_INFRA = join(REPO_ROOT, "docs", "internal", "ci-cd", "AGENT_INFRA.md");
const REQUIRED_CHECKS = join(REPO_ROOT, "scripts", "ci", "lib", "required-checks.mjs");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

const NOW = Date.parse("2026-09-09T13:15:00Z");
const HOUR = 60 * 60 * 1000;

function hoursAgo(hours) {
  return new Date(NOW - hours * HOUR).toISOString();
}

function successJob({ hours = 16 } = {}) {
  return {
    name: PRODUCTION_JOB_NAME,
    status: "completed",
    conclusion: "success",
    started_at: hoursAgo(hours + 0.1),
    completed_at: hoursAgo(hours),
  };
}

/**
 * This watch's verdict through the shared rules, with its own job name and
 * windows. `jobs` are the newest run's; `olderJobs` maps an earlier run's id
 * to `{ status, jobs }`. The rules themselves are tested in
 * backup-job-freshness.test.mjs.
 */
function evaluate(overrides = {}) {
  const { runsStatus, runs, jobsStatus, jobs, olderJobs, now } = {
    runsStatus: 200,
    runs: [{ id: 1, status: "completed", created_at: hoursAgo(16) }],
    jobsStatus: 200,
    jobs: [successJob()],
    olderJobs: {},
    now: NOW,
    ...overrides,
  };
  const jobsByRunId = new Map(
    Object.entries(olderJobs).map(([id, entry]) => [Number(id), entry]),
  );
  if (Array.isArray(runs) && runs.length > 0) {
    jobsByRunId.set(runsNewestFirst(runs)[0].id, { status: jobsStatus, jobs });
  }
  return evaluateJobFreshness({
    jobName: PRODUCTION_JOB_NAME,
    workflowFile: WORKFLOW_FILE,
    staleAfterMs: STALE_AFTER_MS,
    hungAfterMs: HUNG_AFTER_MS,
    timeoutMs: JOB_TIMEOUT_MS,
    runsStatus,
    runs,
    jobsByRunId,
    now,
  });
}

describe("the verdict for this watch", () => {
  it("passes a success younger than 36h", () => {
    const verdict = evaluate();
    assert.equal(verdict.ok, true);
    assert.equal(verdict.fresh, true);
    assert.match(verdict.reason, /succeeded within 36h/);
  });

  it("fails a success older than 36h", () => {
    const verdict = evaluate({
      runs: [{ id: 1, status: "completed", created_at: hoursAgo(40) }],
      jobs: [successJob({ hours: 40 })],
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.fresh, false);
    assert.match(verdict.reason, /older than 36h/);
    assert.ok(40 * HOUR > STALE_AFTER_MS);
  });

  it("evaluates the newest run even when the list is unsorted", () => {
    const verdict = evaluate({
      runs: [
        { id: 1, status: "completed", created_at: hoursAgo(16) },
        { id: 2, status: "completed", created_at: hoursAgo(1) },
      ],
      jobs: [
        {
          name: PRODUCTION_JOB_NAME,
          status: "completed",
          conclusion: "failure",
          completed_at: hoursAgo(1),
        },
      ],
      olderJobs: {
        1: {
          status: 200,
          jobs: [
            {
              name: PRODUCTION_JOB_NAME,
              status: "completed",
              conclusion: "failure",
              completed_at: hoursAgo(16),
            },
          ],
        },
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /concluded failure/);
  });

  it("fails a missing backup-production job on a completed run", () => {
    const verdict = evaluate({
      jobs: [{ name: "backup-staging", status: "completed", conclusion: "success" }],
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /missing/);
  });

  it("does not treat a backup-production-storage success as the dump", () => {
    const verdict = evaluate({
      jobs: [
        {
          name: "backup-production-storage",
          status: "completed",
          conclusion: "success",
          completed_at: hoursAgo(1),
        },
      ],
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /missing/);
  });

  it("fails skipped, cancelled, and failed conclusions", () => {
    for (const conclusion of ["failure", "cancelled", "skipped"]) {
      const verdict = evaluate({
        jobs: [
          {
            name: PRODUCTION_JOB_NAME,
            status: "completed",
            conclusion,
            completed_at: hoursAgo(1),
          },
        ],
      });
      assert.equal(verdict.ok, false, conclusion);
      assert.match(verdict.reason, new RegExp(`concluded ${conclusion}`));
    }
  });

  it("passes an in-flight job younger than 3h when a success within 36h backs it", () => {
    const verdict = evaluate({
      runs: [
        { id: 1, status: "in_progress", created_at: hoursAgo(1) },
        { id: 0, status: "completed", created_at: hoursAgo(16.2) },
      ],
      olderJobs: { 0: { status: 200, jobs: [successJob()] } },
      jobs: [
        {
          name: PRODUCTION_JOB_NAME,
          status: "in_progress",
          conclusion: null,
          started_at: hoursAgo(1),
        },
      ],
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.fresh, false);
    assert.match(verdict.reason, /in flight/);
  });

  it("fails an in-flight job older than 3h", () => {
    const verdict = evaluate({
      runs: [{ id: 1, status: "in_progress", created_at: hoursAgo(4) }],
      jobs: [
        {
          name: PRODUCTION_JOB_NAME,
          status: "in_progress",
          conclusion: null,
          started_at: hoursAgo(4),
        },
      ],
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /hung for more than 3h/);
    assert.ok(4 * HOUR > HUNG_AFTER_MS);
  });

  it("treats a queued run with no jobs yet as in-flight under 3h", () => {
    const verdict = evaluate({
      runs: [
        { id: 1, status: "queued", created_at: hoursAgo(0.5) },
        { id: 0, status: "completed", created_at: hoursAgo(16.2) },
      ],
      olderJobs: { 0: { status: 200, jobs: [successJob()] } },
      jobs: [],
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.fresh, false);
    assert.match(verdict.reason, /in flight/);
  });

  it("fails when Actions runs are unreadable or empty", () => {
    assert.equal(evaluate({ runsStatus: 500, runs: null }).ok, false);
    assert.match(evaluate({ runsStatus: 500, runs: null }).reason, /unreadable \(HTTP 500\)/);
    assert.equal(evaluate({ runs: [] }).ok, false);
    assert.match(evaluate({ runs: [] }).reason, /no db-backup.yml runs found/);
  });

  it("fails when the newest run's jobs are unreadable", () => {
    const verdict = evaluate({ jobsStatus: 502, jobs: null });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /jobs unreadable \(HTTP 502\)/);
  });
});

describe("token preference", () => {
  it("prefers GITHUB_TOKEN and falls back to GITHUB_PAT only when they differ", () => {
    assert.equal(resolveActionsReadToken({ GITHUB_TOKEN: "tok", GITHUB_PAT: "pat" }), "tok");
    assert.equal(resolveActionsReadToken({ GITHUB_PAT: "pat" }), "pat");
    assert.equal(resolveActionsFallbackToken({ GITHUB_TOKEN: "tok", GITHUB_PAT: "pat" }), "pat");
    assert.equal(resolveActionsFallbackToken({ GITHUB_TOKEN: "tok" }), "");
    assert.equal(resolveActionsFallbackToken({ GITHUB_PAT: "pat" }), "");
  });
});

describe("readDumpFreshness", () => {
  function dumpRoutes({
    runsStatus = 200,
    jobsStatus = 200,
    runs = [{ id: 99, status: "completed", created_at: hoursAgo(16) }],
    jobs = [successJob()],
  } = {}) {
    return [
      {
        method: "GET",
        path: `/actions/workflows/${WORKFLOW_FILE}/runs`,
        status: runsStatus,
        body: { workflow_runs: runs },
      },
      {
        method: "GET",
        path: "/actions/runs/99/jobs",
        status: jobsStatus,
        body: { jobs },
      },
    ];
  }

  it("GETs runs then the newest run's jobs", async () => {
    const { fetchImpl, calls } = makeFetchMock(dumpRoutes());
    const verdict = await readDumpFreshness({
      token: "tok",
      repo: "org/repo",
      fetchImpl,
      now: NOW,
    });
    assert.equal(verdict.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /workflows\/db-backup\.yml\/runs/);
    assert.match(calls[0].url, /branch=main/);
    assert.match(calls[1].url, /actions\/runs\/99\/jobs/);
  });

  it("retries with GITHUB_PAT only on 401/403", async () => {
    const calls = [];
    let runsGets = 0;
    const fetchImpl = async (url, init = {}) => {
      calls.push({ method: init.method ?? "GET", url });
      if (String(url).includes(`/actions/workflows/${WORKFLOW_FILE}/runs`)) {
        runsGets += 1;
        if (runsGets === 1) {
          return { ok: false, status: 401, text: async () => "{}" };
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              workflow_runs: [{ id: 99, status: "completed", created_at: hoursAgo(16) }],
            }),
        };
      }
      if (String(url).includes("/actions/runs/99/jobs")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ jobs: [successJob()] }),
        };
      }
      throw new Error(`unexpected ${init.method ?? "GET"} ${url}`);
    };
    const verdict = await readDumpFreshness({
      token: "tok",
      fallbackToken: "pat",
      repo: "org/repo",
      fetchImpl,
      now: NOW,
    });
    assert.equal(verdict.ok, true);
    assert.equal(calls.length, 3);
  });

  it("does not retry a 500", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: `/actions/workflows/${WORKFLOW_FILE}/runs`,
        status: 500,
        body: {},
      },
    ]);
    const verdict = await readDumpFreshness({
      token: "tok",
      fallbackToken: "pat",
      repo: "org/repo",
      fetchImpl,
      now: NOW,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /unreadable \(HTTP 500\)/);
    assert.equal(calls.length, 1);
  });
});

// #2332, on this watch: the newest run was cancelled, so the verdict rests
// on an earlier run of this watch's own job. The rules, and how far back the
// reader looks, are tested in backup-job-freshness.test.mjs.
describe("readDumpFreshness: an earlier run backs a cancelled newest run", () => {
  function routes({ earlier }) {
    return [
      {
        method: "GET",
        path: `/actions/workflows/${WORKFLOW_FILE}/runs`,
        body: {
          workflow_runs: [
            { id: 99, status: "completed", conclusion: "cancelled", created_at: hoursAgo(2), updated_at: hoursAgo(2) },
            { id: 98, status: "completed", created_at: hoursAgo(16.2), updated_at: earlier.completed_at },
          ],
        },
      },
      {
        method: "GET",
        path: "/actions/runs/99/jobs",
        body: { jobs: [{ name: PRODUCTION_JOB_NAME, status: "completed", conclusion: "cancelled", completed_at: hoursAgo(1.5) }] },
      },
      { method: "GET", path: "/actions/runs/98/jobs", body: { jobs: [earlier] } },
    ];
  }

  it("passes, without closing the alert, on this job's success within 36h", async () => {
    const { fetchImpl, calls } = makeFetchMock(routes({ earlier: successJob() }));
    const verdict = await readDumpFreshness({ token: "tok", repo: "org/repo", fetchImpl, now: NOW });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.fresh, false);
    assert.match(verdict.reason, new RegExp(`concluded cancelled; an earlier ${PRODUCTION_JOB_NAME} succeeded 16h ago`));
    assert.equal(calls.length, 3);
  });

  it("fails when the earlier success belongs to another job", async () => {
    const other = { ...successJob(), name: `${PRODUCTION_JOB_NAME}-other` };
    const { fetchImpl } = makeFetchMock(routes({ earlier: other }));
    const verdict = await readDumpFreshness({ token: "tok", repo: "org/repo", fetchImpl, now: NOW });
    assert.equal(verdict.ok, false);
  });
});

// This watch's own windows and timeout reach the shared rules. The rules are
// tested with their own values in backup-job-freshness.test.mjs; these prove
// the script passes its constants, not someone else's.
describe("readDumpFreshness: this watch's windows", () => {
  function read(runs, jobsById) {
    const { fetchImpl } = makeFetchMock([
      { method: "GET", path: `/actions/workflows/${WORKFLOW_FILE}/runs`, body: { workflow_runs: runs } },
      ...Object.entries(jobsById).map(([id, jobs]) => ({ method: "GET", path: `/actions/runs/${id}/jobs`, body: { jobs } })),
    ]);
    return readDumpFreshness({ token: "tok", repo: "org/repo", fetchImpl, now: NOW });
  }

  it("fails a newest success older than 36h", async () => {
    const verdict = await read([{ id: 99, status: "completed", created_at: hoursAgo(40.2) }], { 99: [successJob({ hours: 40 })] });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /older than 36h/);
  });

  it("fails a job in flight for more than 3h", async () => {
    const verdict = await read(
      [{ id: 99, status: "in_progress", created_at: hoursAgo(4) }],
      { 99: [{ name: PRODUCTION_JOB_NAME, status: "in_progress", conclusion: null, started_at: hoursAgo(4) }] },
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /hung for more than 3h/);
  });

  it("fails a job cancelled at this watch's timeout, and backs one cancelled well before it", async () => {
    const cancelledAfter = (ms) => ({
      name: PRODUCTION_JOB_NAME,
      status: "completed",
      conclusion: "cancelled",
      started_at: new Date(NOW - HOUR - ms).toISOString(),
      completed_at: new Date(NOW - HOUR).toISOString(),
    });
    const runs = [
      { id: 99, status: "completed", conclusion: "cancelled", created_at: hoursAgo(2) },
      { id: 98, status: "completed", created_at: hoursAgo(16.2), updated_at: hoursAgo(16) },
    ];
    const timedOut = await read(runs, { 99: [cancelledAfter(JOB_TIMEOUT_MS)], 98: [successJob()] });
    assert.equal(timedOut.ok, false);
    assert.match(timedOut.reason, new RegExp(`hit its ${JOB_TIMEOUT_MS / 60000}-minute timeout`));
    for (const ms of [JOB_TIMEOUT_MS / 3, JOB_TIMEOUT_MS - 5 * 60 * 1000]) {
      const early = await read(runs, { 99: [cancelledAfter(ms)], 98: [successJob()] });
      assert.equal(early.ok, true, `cancelled after ${ms / 60000} minutes`);
    }
  });

  it("JOB_TIMEOUT_MS is the job's timeout-minutes in db-backup.yml", () => {
    const job = workflowJobs(join(WORKFLOWS_DIR, "db-backup.yml")).find((j) => j.jobId === PRODUCTION_JOB_NAME);
    assert.ok(job, `${PRODUCTION_JOB_NAME} job not found in db-backup.yml`);
    assert.equal(Number(job.keys.get("timeout-minutes")) * 60 * 1000, JOB_TIMEOUT_MS);
  });
});

describe("runWatchdog", () => {
  const failVerdict = {
    ok: false,
    reason: "last backup-production success is older than 36h",
  };
  const passVerdict = {
    ok: true,
    fresh: true,
    reason: "backup-production succeeded within 36h",
  };
  const inFlightVerdict = {
    ok: true,
    fresh: false,
    reason: "backup-production is in flight",
  };

  it("creates a P1 incident alert, assigned to the owner, and refuses a GitHub closer", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: "/issues?state=all", body: [] },
      { method: "POST", path: "/issues", body: { number: 42 } },
    ]);
    const created = await runWatchdog({
      verdict: failVerdict,
      token: "t",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(created.outcome, "fail");
    assert.equal(created.alert.action, "created");
    const createdBody = JSON.parse(calls.find((c) => c.method === "POST").body);
    assert.equal(createdBody.title, ALERT_ISSUE_TITLE);
    assert.ok(createdBody.labels.includes(ALERT_LOOKUP_LABEL));
    assert.deepEqual(createdBody.assignees, [ALERT_ASSIGNEE]);
    assert.ok(createdBody.labels.includes("P1"));
    assert.doesNotMatch(createdBody.body, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
  });

  it("comments on an already-open alert instead of filing a second", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "PATCH", path: "/issues/42", body: { number: 42 } },
      { method: "POST", path: "/comments", body: {} },
    ]);
    const again = await runWatchdog({
      verdict: failVerdict,
      token: "t",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(again.outcome, "fail");
    assert.equal(again.alert.action, "commented");
    assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/comments")));
  });

  it("closes the alert on recovery only when lookup succeeded", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "PATCH", path: "/issues/42", body: { number: 42 } },
      { method: "POST", path: "/comments", body: {} },
    ]);
    const out = await runWatchdog({
      verdict: passVerdict,
      token: "t",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(out.outcome, "pass");
    assert.equal(out.resolved, true);
    assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/42")));
  });

  it("does not close an alert when the lookup itself failed", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: "/issues?state=all", status: 500, body: {} },
    ]);
    const out = await runWatchdog({
      verdict: passVerdict,
      token: "t",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(out.outcome, "pass");
    assert.equal(out.resolved, false);
    assert.equal(out.lookupOk, false);
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
  });

  it("does not treat a failed close PATCH as recovery", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "POST", path: "/comments", body: {} },
      { method: "PATCH", path: "/issues/42", status: 502, body: {} },
    ]);
    const out = await runWatchdog({
      verdict: passVerdict,
      token: "t",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(out.outcome, "fail");
    assert.equal(out.resolved, false);
    assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/42")));
  });

  it("does not close an open alert while the dump is only in flight", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
    ]);
    const out = await runWatchdog({
      verdict: inFlightVerdict,
      token: "t",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(out.outcome, "pass");
    assert.equal(out.resolved, false);
    assert.equal(out.pending, true);
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  });
});

function uncommented(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/**
 * The first lock imported PRODUCTION_JOB_NAME into every fixture, so
 * renaming the watch to backup-production-storage (1964) would still pass.
 * Pin the assignment lines. Storage freshness stays on its own leftover.
 */
export function scriptPinProblems(source) {
  const problems = [];
  if (!/^export const PRODUCTION_JOB_NAME = "backup-production";?$/m.test(source)) {
    problems.push("PRODUCTION_JOB_NAME must stay backup-production");
  }
  if (!/^export const DEFAULT_BRANCH = "main";?$/m.test(source)) {
    problems.push("DEFAULT_BRANCH must stay main");
  }
  if (!/^export const WORKFLOW_FILE = "db-backup.yml";?$/m.test(source)) {
    problems.push("WORKFLOW_FILE must stay db-backup.yml");
  }
  if (!/^export const STALE_AFTER_MS = 36 \* 60 \* 60 \* 1000;?$/m.test(source)) {
    problems.push("STALE_AFTER_MS must stay 36h");
  }
  if (!/^export const HUNG_AFTER_MS = 3 \* 60 \* 60 \* 1000;?$/m.test(source)) {
    problems.push("HUNG_AFTER_MS must stay 3h");
  }
  if (!/branch=\$\{encodeURIComponent\(DEFAULT_BRANCH\)\}/.test(source)) {
    problems.push("runs GET must stay scoped to DEFAULT_BRANCH");
  }
  if (!/if \(!verdict\.fresh\)/.test(source)) {
    problems.push("in-flight must not close the alert");
  }
  if (!/per_page=\$\{RUNS_PER_PAGE\}/.test(source)) {
    problems.push("runs GET must list RUNS_PER_PAGE runs from the shared lib");
  }
  if (!/verdictLogLine\(verdict\)/.test(source)) {
    problems.push("main() must print through verdictLogLine, so a backed pass shows as a warning");
  }
  return problems;
}

export function watchdogWorkflowProblems(yaml) {
  const live = uncommented(yaml);
  const problems = [];
  if (/^\s*environment:\s/m.test(live)) {
    problems.push("must not name a GitHub environment");
  }
  if (/environment:\s*production-backup/.test(live)) {
    problems.push("must not name environment: production-backup");
  }
  if (/npm ci/.test(live)) {
    problems.push("must not npm ci");
  }
  if (/pull_request:/.test(yaml)) {
    problems.push("must not be a pull_request check");
  }
  if (!/cron: "15 13 \* \* \*"/.test(yaml)) {
    problems.push("cron must stay 13:15");
  }
  if (/cron:\s*"30 6 \* \* \*"/.test(live)) {
    problems.push("must not collide with db-backup.yml at 06:30");
  }
  return problems;
}

describe("workflow wiring", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const liveYaml = uncommented(workflow);
  const script = readFileSync(SCRIPT, "utf8");
  const routing = readFileSync(ALERT_ROUTING, "utf8");
  const infra = readFileSync(AGENT_INFRA, "utf8");
  const roster = readFileSync(REQUIRED_CHECKS, "utf8");

  it("does not name a GitHub environment", () => {
    assert.doesNotMatch(liveYaml, /^\s*environment:\s/m);
    assert.doesNotMatch(liveYaml, /environment:\s*production/);
    assert.doesNotMatch(liveYaml, /environment:\s*["']production/);
    assert.doesNotMatch(liveYaml, /environment:\s*production-backup/);
  });

  it("is schedule + workflow_dispatch only — not a required PR check", () => {
    assert.match(workflow, /cron: "15 13 \* \* \*"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /pull_request:/);
    assert.doesNotMatch(roster, /production-backup-freshness/);
  });

  it("no other daily schedule shares 13:15", () => {
    for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))) {
      if (file === "production-backup-freshness.yml") continue;
      const text = uncommented(readFileSync(join(WORKFLOWS_DIR, file), "utf8"));
      assert.doesNotMatch(
        text,
        /cron:\s*"15 13 \* \* \*"/,
        `${file} collides with production-backup-freshness.yml at 13:15 UTC`,
      );
    }
  });

  it("does not change db-backup.yml cron", () => {
    const backup = uncommented(readFileSync(join(WORKFLOWS_DIR, "db-backup.yml"), "utf8"));
    assert.match(backup, /cron:\s*"30 6 \* \* \*"/);
    assert.doesNotMatch(liveYaml, /cron:\s*"30 6 \* \* \*"/);
  });

  it("never PUTs an environment or a workflow", () => {
    assert.doesNotMatch(script, /method:\s*["']PUT["']/);
    assert.doesNotMatch(script, /\/environments\//);
  });

  it("ALERT_ROUTING.md lists this alert title so the roster cannot drop it again", () => {
    assert.ok(
      routing.includes(ALERT_ISSUE_TITLE),
      "ALERT_ROUTING.md must name the new alert; #1674 was this exact miss for guardrails",
    );
  });

  it("AGENT_INFRA.md roster and scheduled table name this job", () => {
    assert.match(infra, /production-backup-freshness\.yml/);
    assert.match(infra, /13:15/);
  });

  it("the script refuses a GitHub closer in its alert copy", () => {
    assert.doesNotMatch(script, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
  });

  it("pins the dump job, main branch, and 36h / 3h windows", () => {
    assert.deepEqual(scriptPinProblems(script), []);
  });

  it("the live watchdog YAML stays clean", () => {
    assert.deepEqual(watchdogWorkflowProblems(workflow), []);
  });

  it("requires a GitHub token before the Actions GET", () => {
    const main = script.slice(script.indexOf("async function main()"));
    const tokenIdx = main.indexOf("resolveActionsReadToken");
    const readIdx = main.indexOf("await readDumpFreshness");
    assert.ok(tokenIdx !== -1, "main() must resolve an Actions-read token");
    assert.ok(readIdx !== -1, "main() must GET the dump runs");
    assert.ok(tokenIdx < readIdx, "a missing token must not look like a successful watch");
  });

  it("skips the alert write on --probe-only", () => {
    const main = script.slice(script.indexOf("async function main()"));
    const probeIdx = main.indexOf('process.argv.includes("--probe-only")');
    const writeIdx = main.indexOf("await runWatchdog");
    assert.ok(probeIdx !== -1 && writeIdx !== -1);
    assert.ok(probeIdx < writeIdx);
    assert.match(main, /if \(probeOnly\) \{\s*process\.exit\(verdict\.ok \? 0 : 1\);/s);
  });

  it("passes no GITHUB_PAT and runs with no npm ci", () => {
    // #2518: this job names no environment, so a PAT here could only be a
    // repository secret, and a repository secret is readable from any branch.
    // The script still honours GITHUB_PAT for a local run.
    assert.doesNotMatch(liveYaml, /secrets\.GITHUB_PAT/);
    assert.match(liveYaml, /node scripts\/ci\/production-backup-freshness\.mjs/);
    assert.doesNotMatch(liveYaml, /npm ci/);
  });

  it("scopes issues: write to the job, not the workflow", () => {
    const workflowGrant = workflow.slice(
      workflow.indexOf("permissions:"),
      workflow.indexOf("concurrency:"),
    );
    assert.match(workflowGrant, /contents: read/);
    assert.doesNotMatch(workflowGrant, /issues: write/);
    assert.doesNotMatch(workflowGrant, /actions: read/);
    assert.match(liveYaml, /issues: write/);
    assert.match(liveYaml, /actions: read/);
  });
});

describe("watchdog mutations", () => {
  const script = readFileSync(SCRIPT, "utf8");
  const workflow = readFileSync(WORKFLOW, "utf8");

  it("renaming the watch to the storage job fails", () => {
    const problems = scriptPinProblems(
      script.replace(
        'export const PRODUCTION_JOB_NAME = "backup-production"',
        'export const PRODUCTION_JOB_NAME = "backup-production-storage"',
      ),
    );
    assert.ok(
      problems.some((problem) => problem.includes("backup-production")),
      problems.join("; "),
    );
  });

  it("dropping the main-branch scope fails", () => {
    const problems = scriptPinProblems(
      script.replace(
        'export const DEFAULT_BRANCH = "main"',
        'export const DEFAULT_BRANCH = "production"',
      ),
    );
    assert.ok(
      problems.some((problem) => problem.includes("main")),
      problems.join("; "),
    );
  });

  it("widening the stale window past 36h fails", () => {
    const problems = scriptPinProblems(
      script.replace(
        "export const STALE_AFTER_MS = 36 * 60 * 60 * 1000",
        "export const STALE_AFTER_MS = 72 * 60 * 60 * 1000",
      ),
    );
    assert.ok(
      problems.some((problem) => problem.includes("36h")),
      problems.join("; "),
    );
  });

  it("naming environment: production-backup on the watchdog fails", () => {
    const problems = watchdogWorkflowProblems(
      `${workflow}\n    environment: production-backup\n`,
    );
    assert.ok(
      problems.some((problem) => problem.includes("production-backup")),
      problems.join("; "),
    );
  });

  it("adding npm ci fails", () => {
    const problems = watchdogWorkflowProblems(`${workflow}\n      - run: npm ci\n`);
    assert.ok(
      problems.some((problem) => problem.includes("npm ci")),
      problems.join("; "),
    );
  });

  it("hard-coding the runs page size fails", () => {
    const problems = scriptPinProblems(script.replace("per_page=${RUNS_PER_PAGE}", "per_page=10"));
    assert.ok(problems.some((problem) => problem.includes("RUNS_PER_PAGE")), problems.join("; "));
  });

  it("printing the verdict by hand fails", () => {
    const problems = scriptPinProblems(
      script.replace("verdictLogLine(verdict)", "`✅ ${verdict.reason}`"),
    );
    assert.ok(problems.some((problem) => problem.includes("verdictLogLine")), problems.join("; "));
  });

  it("dropping the in-flight fresh gate fails", () => {
    const problems = scriptPinProblems(script.replace("if (!verdict.fresh)", "if (false)"));
    assert.ok(
      problems.some((problem) => problem.includes("in-flight")),
      problems.join("; "),
    );
  });

  it("moving the cron onto the dump slot fails", () => {
    const problems = watchdogWorkflowProblems(
      workflow.replace('cron: "15 13 * * *"', 'cron: "30 6 * * *"'),
    );
    assert.ok(
      problems.some((problem) => /13:15|06:30/.test(problem)),
      problems.join("; "),
    );
  });
});

describe("leftover lock hygiene", () => {
  it("refuses a GitHub closer next to an issue number", () => {
    const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const script = readFileSync(SCRIPT, "utf8");
    const workflow = readFileSync(WORKFLOW, "utf8");
    for (const [rel, source] of [
      ["test", lock],
      ["script", script],
      ["workflow", workflow],
    ]) {
      assert.doesNotMatch(
        source,
        /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
        rel,
      );
    }
  });
});
