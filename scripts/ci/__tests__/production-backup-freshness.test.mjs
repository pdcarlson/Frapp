import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ALERT_ROUTING as ALERT_ROUTING_DOC } from "../lib/ops-docs.mjs";
import { fileURLToPath } from "node:url";

import {
  WATCHES,
  WORKFLOW_FILE,
  readBackupFreshness,
  resolveActionsFallbackToken,
  resolveActionsReadToken,
  resolveWatch,
  runWatchdog,
} from "../production-backup-freshness.mjs";
import { ALERT_ASSIGNEE, ALERT_LOOKUP_LABEL } from "../lib/alert-issue.mjs";

import { makeFetchMock } from "./helpers.mjs";
import { installsDependenciesIn, workflowFiles, workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

// One script serves both production backup-freshness watches (#2328). Every
// suite below runs once per watch.
//
// What each watch is comes from EXPECTED, written out here, never from the
// script's own WATCHES: a fixture built from the script's job name follows a
// rename, so pointing the dump watch at the Storage job would still pass. With
// literals here, crossing the two watches (in the table or in either
// workflow's BACKUP_WATCH) fails this suite.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "production-backup-freshness.mjs");
const ALERT_ROUTING = join(REPO_ROOT, ALERT_ROUTING_DOC);
const AGENT_INFRA = join(REPO_ROOT, "docs", "ci-cd", "agent-infra.md");
const REQUIRED_CHECKS = join(REPO_ROOT, "scripts", "ci", "lib", "required-checks.mjs");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

const EXPECTED = [
  {
    key: "dump",
    jobName: "backup-production",
    otherJobName: "backup-production-storage",
    timeoutMinutes: 30,
    title: "Nightly production dump is stale or failed — recoverability is unproven",
    // Phrases only this watch's alert copy carries, so swapping copy between
    // the watches fails: the body opening, the recovery step, a sentence of
    // its why, and the recovery comment.
    bodyPhrases: [
      "The nightly production Postgres dump is missing, failed, hung, or older than 36 hours.",
      "Inspect the latest `backup-production` job and recover the dump,",
      "is the only copy of `frapp-prod` outside Supabase",
    ],
    recovery: "Nightly production dump is fresh again: ",
    workflow: "production-backup-freshness.yml",
    cron: "15 13 * * *",
    slot: "13:15",
    now: "2026-09-09T13:15:00Z",
    // Slots this watch must never take: db-backup.yml's own cron.
    forbiddenCrons: [{ cron: "30 6 * * *", slot: "06:30" }],
  },
  {
    key: "storage",
    jobName: "backup-production-storage",
    otherJobName: "backup-production",
    timeoutMinutes: 60,
    title: "Nightly production Storage mirror is stale or failed — recoverability is unproven",
    bodyPhrases: [
      "The nightly production Storage mirror is missing, failed, hung, or older than 36 hours.",
      "Inspect the latest `backup-production-storage` job and recover the mirror,",
      "is the Storage half for `frapp-prod`",
      "A failed job may be the job refusing bad content rather than crashing",
    ],
    recovery: "Nightly production Storage mirror is fresh again: ",
    workflow: "production-backup-storage-freshness.yml",
    cron: "0 14 * * *",
    slot: "14:00",
    now: "2026-09-09T13:30:00Z",
    forbiddenCrons: [
      { cron: "30 6 * * *", slot: "06:30" },
      // The dump watch's slot, chosen against the dump job's 30-minute budget.
      { cron: "15 13 * * *", slot: "13:15" },
      // 13:30 was this watch's original slot, copied from the dump watch. It is
      // only ~26 minutes past the latest observed storage-job start (13:04 UTC,
      // measured 2026-09-17), so a scheduling-lag night can put the probe
      // inside a healthy run, which then can only pass on the previous night's
      // success (as a warning that never closes an open alert) instead of
      // counting tonight's own. Do not move back onto it.
      { cron: "30 13 * * *", slot: "13:30" },
    ],
  },
];

const HOUR = 60 * 60 * 1000;

/** A `cron: "<expr>"` line, tolerant of the spacing YAML allows. */
function cronPattern(cron) {
  return new RegExp(`cron:\\s*["']${cron.replaceAll("*", "\\*")}["']`);
}

/**
 * `BACKUP_WATCH` as Actions would hand it to each step that runs the script:
 * workflow, job and step env merged, innermost winning. A value on another
 * step reaches nothing, and the script then throws before it can file an
 * alert. `workflowSteps` reads a path, so the text goes through a temp file.
 */
function watchesGivenToScript(yaml) {
  const dir = mkdtempSync(join(tmpdir(), "backup-watch-"));
  try {
    const path = join(dir, "workflow.yml");
    writeFileSync(path, yaml);
    return workflowSteps(path)
      .filter((step) => /node scripts\/ci\/production-backup-freshness\.mjs/.test(step.body))
      .map((step) => step.env.get("BACKUP_WATCH"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function uncommented(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("the watch table", () => {
  it("holds exactly the two watches, each on its own job and alert", () => {
    assert.deepEqual(Object.keys(WATCHES).sort(), EXPECTED.map((e) => e.key).sort());
    for (const expected of EXPECTED) {
      const watch = WATCHES[expected.key];
      assert.equal(watch.jobName, expected.jobName, expected.key);
      assert.equal(watch.timeoutMs, expected.timeoutMinutes * 60 * 1000, expected.key);
      // The title is the open alert's lookup key; editing it orphans that alert.
      assert.equal(watch.alert.title, expected.title, expected.key);
      assert.ok(watch.alert.labels.includes("P1"), expected.key);
    }
  });

  it("resolveWatch returns the named watch and throws on a missing or unknown name", () => {
    for (const { key, jobName } of EXPECTED) assert.equal(resolveWatch(key).jobName, jobName);
    assert.throws(() => resolveWatch(undefined), /Unknown or missing BACKUP_WATCH/);
    assert.throws(() => resolveWatch(""), /Unknown or missing BACKUP_WATCH/);
    assert.throws(() => resolveWatch("backup-production"), /Unknown or missing BACKUP_WATCH/);
    assert.throws(() => resolveWatch("toString"), /Unknown or missing BACKUP_WATCH/);
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

for (const expected of EXPECTED) {
  const { key, jobName, otherJobName } = expected;
  const watch = WATCHES[key];
  const NOW = Date.parse(expected.now);
  const JOB_TIMEOUT_MS = expected.timeoutMinutes * 60 * 1000;

  const hoursAgo = (hours) => new Date(NOW - hours * HOUR).toISOString();

  const successJob = ({ hours = 16 } = {}) => ({
    name: jobName,
    status: "completed",
    conclusion: "success",
    started_at: hoursAgo(hours + 0.1),
    completed_at: hoursAgo(hours),
  });

  // These drive the script's reader with the script's own watch, so a watch
  // wired to the other job, or to the other job's timeout, fails against
  // these fixtures, which name this watch's job by literal. The rules
  // themselves are tested once, in backup-job-freshness.test.mjs.
  const read = (args) => readBackupFreshness({ watch, token: "tok", repo: "org/repo", now: NOW, ...args });

  describe(`${key} watch: readBackupFreshness`, () => {
    function routes({
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
        { method: "GET", path: "/actions/runs/99/jobs", status: jobsStatus, body: { jobs } },
      ];
    }

    it("GETs runs then the newest run's jobs", async () => {
      const { fetchImpl, calls } = makeFetchMock(routes());
      const verdict = await read({ fetchImpl });
      assert.equal(verdict.ok, true, verdict.reason);
      assert.equal(calls.length, 2);
      assert.match(calls[0].url, /workflows\/db-backup\.yml\/runs/);
      assert.match(calls[0].url, /branch=main/);
      assert.match(calls[1].url, /actions\/runs\/99\/jobs/);
    });

    it(`reads only ${jobName}, not ${otherJobName}`, async () => {
      const { fetchImpl } = makeFetchMock(routes({ jobs: [{ ...successJob(), name: otherJobName }] }));
      const verdict = await read({ fetchImpl });
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason, /missing/);
    });

    it("retries with GITHUB_PAT only on 401/403", async () => {
      const calls = [];
      let runsGets = 0;
      const fetchImpl = async (url, init = {}) => {
        calls.push({ method: init.method ?? "GET", url });
        if (String(url).includes(`/actions/workflows/${WORKFLOW_FILE}/runs`)) {
          runsGets += 1;
          if (runsGets === 1) return { ok: false, status: 401, text: async () => "{}" };
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ workflow_runs: [{ id: 99, status: "completed", created_at: hoursAgo(16) }] }),
          };
        }
        if (String(url).includes("/actions/runs/99/jobs")) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ jobs: [successJob()] }) };
        }
        throw new Error(`unexpected ${init.method ?? "GET"} ${url}`);
      };
      const verdict = await read({ fallbackToken: "pat", fetchImpl });
      assert.equal(verdict.ok, true);
      assert.equal(calls.length, 3);
    });

    // The read that follows a refused token retries too (#2333), so a blip on
    // it doesn't file a P1 either.
    it("retries a 5xx on the fallback read after a 401", async () => {
      const calls = [];
      let runsGets = 0;
      const fetchImpl = async (url, init = {}) => {
        calls.push({ method: init.method ?? "GET", url, token: init.headers?.Authorization });
        if (String(url).includes(`/actions/workflows/${WORKFLOW_FILE}/runs`)) {
          runsGets += 1;
          if (runsGets === 1) return { ok: false, status: 401, text: async () => "{}" };
          if (runsGets === 2) return { ok: false, status: 502, text: async () => "{}" };
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ workflow_runs: [{ id: 99, status: "completed", created_at: hoursAgo(16) }] }),
          };
        }
        if (String(url).includes("/actions/runs/99/jobs")) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ jobs: [successJob()] }) };
        }
        throw new Error(`unexpected ${init.method ?? "GET"} ${url}`);
      };
      const verdict = await read({ fallbackToken: "pat", fetchImpl, retryOptions: { sleep: async () => {} } });
      assert.equal(verdict.ok, true, verdict.reason);
      assert.deepEqual(
        calls.slice(0, 3).map((c) => c.token),
        ["Bearer tok", "Bearer pat", "Bearer pat"],
      );
    });

    // #2333: a blip on the Actions read is re-asked on the same token before
    // the verdict calls it unreadable. The fallback token is only for 401/403.
    it("retries a 500 on the same token, never with the fallback token", async () => {
      const { fetchImpl, calls } = makeFetchMock([
        { method: "GET", path: `/actions/workflows/${WORKFLOW_FILE}/runs`, status: 500, body: {} },
      ]);
      const verdict = await read({ fallbackToken: "pat", fetchImpl, retryOptions: { sleep: async () => {} } });
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason, /unreadable \(HTTP 500\)/);
      assert.equal(calls.length, 3, "three attempts on one token; the fallback would add three more");
    });
  });

  // #2332, on this watch: the newest run was cancelled, so the verdict rests
  // on an earlier run of this watch's own job. The rules, and how far back the
  // reader looks, are tested in backup-job-freshness.test.mjs.
  describe(`${key} watch: an earlier run backs a cancelled newest run`, () => {
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
          body: { jobs: [{ name: jobName, status: "completed", conclusion: "cancelled", completed_at: hoursAgo(1.5) }] },
        },
        { method: "GET", path: "/actions/runs/98/jobs", body: { jobs: [earlier] } },
      ];
    }

    it("passes, without closing the alert, on this job's success within 36h", async () => {
      const { fetchImpl, calls } = makeFetchMock(routes({ earlier: successJob() }));
      const verdict = await read({ fetchImpl });
      assert.equal(verdict.ok, true);
      assert.equal(verdict.fresh, false);
      assert.match(verdict.reason, new RegExp(`concluded cancelled; an earlier ${jobName} succeeded 16h ago`));
      assert.equal(calls.length, 3);
    });

    it(`fails when the earlier success is ${otherJobName}'s`, async () => {
      const { fetchImpl } = makeFetchMock(routes({ earlier: { ...successJob(), name: otherJobName } }));
      const verdict = await read({ fetchImpl });
      assert.equal(verdict.ok, false);
    });
  });

  // This watch's own windows and timeout reach the shared rules. The rules are
  // tested with their own values in backup-job-freshness.test.mjs; these prove
  // the script passes this watch's values, not the other watch's.
  describe(`${key} watch: its windows and timeout reach the rules`, () => {
    function readRuns(runs, jobsById) {
      const { fetchImpl } = makeFetchMock([
        { method: "GET", path: `/actions/workflows/${WORKFLOW_FILE}/runs`, body: { workflow_runs: runs } },
        ...Object.entries(jobsById).map(([id, jobs]) => ({ method: "GET", path: `/actions/runs/${id}/jobs`, body: { jobs } })),
      ]);
      return read({ fetchImpl });
    }

    it("fails a newest success older than 36h", async () => {
      const verdict = await readRuns([{ id: 99, status: "completed", created_at: hoursAgo(40.2) }], { 99: [successJob({ hours: 40 })] });
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason, /older than 36h/);
    });

    it("fails a job in flight for more than 3h", async () => {
      const verdict = await readRuns(
        [{ id: 99, status: "in_progress", created_at: hoursAgo(4) }],
        { 99: [{ name: jobName, status: "in_progress", conclusion: null, started_at: hoursAgo(4) }] },
      );
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason, /hung for more than 3h/);
    });

    it(`fails a job cancelled at its ${expected.timeoutMinutes}-minute timeout, and backs one cancelled well before it`, async () => {
      const cancelledAfter = (ms) => ({
        name: jobName,
        status: "completed",
        conclusion: "cancelled",
        started_at: new Date(NOW - HOUR - ms).toISOString(),
        completed_at: new Date(NOW - HOUR).toISOString(),
      });
      const runs = [
        { id: 99, status: "completed", conclusion: "cancelled", created_at: hoursAgo(2) },
        { id: 98, status: "completed", created_at: hoursAgo(16.2), updated_at: hoursAgo(16) },
      ];
      const timedOut = await readRuns(runs, { 99: [cancelledAfter(JOB_TIMEOUT_MS)], 98: [successJob()] });
      assert.equal(timedOut.ok, false);
      assert.match(timedOut.reason, new RegExp(`hit its ${expected.timeoutMinutes}-minute timeout`));
      for (const ms of [JOB_TIMEOUT_MS / 3, JOB_TIMEOUT_MS - 5 * 60 * 1000]) {
        const early = await readRuns(runs, { 99: [cancelledAfter(ms)], 98: [successJob()] });
        assert.equal(early.ok, true, `cancelled after ${ms / 60000} minutes`);
      }
    });

    it("its timeout is the job's timeout-minutes in db-backup.yml", () => {
      const job = workflowJobs(join(WORKFLOWS_DIR, "db-backup.yml")).find((j) => j.jobId === jobName);
      assert.ok(job, `${jobName} job not found in db-backup.yml`);
      assert.equal(Number(job.keys.get("timeout-minutes")), expected.timeoutMinutes);
    });
  });

  describe(`${key} watch: runWatchdog`, () => {
    const failVerdict = { ok: false, reason: `last ${jobName} success is older than 36h` };
    const passVerdict = { ok: true, fresh: true, reason: `${jobName} succeeded within 36h` };
    const inFlightVerdict = { ok: true, fresh: false, reason: `${jobName} is in flight` };
    const run = (verdict, fetchImpl) => runWatchdog({ watch, verdict, token: "t", repo: "org/repo", fetchImpl });
    const openAlert = { method: "GET", path: "/issues?state=all", body: [{ number: 42, title: expected.title, state: "open" }] };

    it("creates a P1 incident alert under this watch's title, assigned to the owner, and refuses a GitHub closer", async () => {
      const { fetchImpl, calls } = makeFetchMock([
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 42 } },
      ]);
      const created = await run(failVerdict, fetchImpl);
      assert.equal(created.outcome, "fail");
      assert.equal(created.alert.action, "created");
      const createdBody = JSON.parse(calls.find((c) => c.method === "POST").body);
      assert.equal(createdBody.title, expected.title);
      assert.ok(createdBody.labels.includes(ALERT_LOOKUP_LABEL));
      assert.deepEqual(createdBody.assignees, [ALERT_ASSIGNEE]);
      assert.ok(createdBody.labels.includes("P1"));
      for (const phrase of expected.bodyPhrases) assert.ok(createdBody.body.includes(phrase), phrase);
      const other = EXPECTED.find((e) => e.key !== key);
      for (const phrase of other.bodyPhrases) assert.ok(!createdBody.body.includes(phrase), `carries ${other.key}'s copy: ${phrase}`);
      assert.doesNotMatch(createdBody.body, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
    });

    it("does not comment on the other watch's open alert", async () => {
      const other = EXPECTED.find((e) => e.key !== key);
      const { fetchImpl, calls } = makeFetchMock([
        { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: other.title, state: "open" }] },
        { method: "POST", path: "/issues", body: { number: 42 } },
      ]);
      const created = await run(failVerdict, fetchImpl);
      assert.equal(created.alert.action, "created");
      assert.equal(calls.some((c) => c.url.includes("/issues/7")), false);
    });

    it("comments on an already-open alert instead of filing a second", async () => {
      const { fetchImpl, calls } = makeFetchMock([
        openAlert,
        { method: "PATCH", path: "/issues/42", body: { number: 42 } },
        { method: "POST", path: "/comments", body: {} },
      ]);
      const again = await run(failVerdict, fetchImpl);
      assert.equal(again.outcome, "fail");
      assert.equal(again.alert.action, "commented");
      assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/comments")));
    });

    it("closes the alert on recovery only when lookup succeeded", async () => {
      const { fetchImpl, calls } = makeFetchMock([
        openAlert,
        { method: "PATCH", path: "/issues/42", body: { number: 42 } },
        { method: "POST", path: "/comments", body: {} },
      ]);
      const out = await run(passVerdict, fetchImpl);
      assert.equal(out.outcome, "pass");
      assert.equal(out.resolved, true);
      assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/42")));
      const comment = JSON.parse(calls.find((c) => c.method === "POST" && c.url.includes("/comments")).body);
      assert.ok(comment.body.startsWith(expected.recovery), comment.body);
    });

    it("does not close an alert when the lookup itself failed, and goes red", async () => {
      const { fetchImpl, calls } = makeFetchMock([
        { method: "GET", path: "/issues?state=all", status: 500, body: {} },
      ]);
      const out = await run(passVerdict, fetchImpl);
      assert.equal(out.outcome, "fail");
      assert.equal(out.resolved, false);
      assert.equal(out.lookupOk, false);
      assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
    });

    it("does not treat a failed close PATCH as recovery", async () => {
      const { fetchImpl, calls } = makeFetchMock([
        openAlert,
        { method: "POST", path: "/comments", body: {} },
        { method: "PATCH", path: "/issues/42", status: 502, body: {} },
      ]);
      const out = await run(passVerdict, fetchImpl);
      assert.equal(out.outcome, "fail");
      assert.equal(out.resolved, false);
      assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/42")));
    });

    it("does not close an open alert while the job is only in flight", async () => {
      const { fetchImpl, calls } = makeFetchMock([openAlert]);
      const out = await run(inFlightVerdict, fetchImpl);
      assert.equal(out.outcome, "pass");
      assert.equal(out.resolved, false);
      assert.equal(out.pending, true);
      assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
      assert.equal(calls.filter((c) => c.method === "POST").length, 0);
    });
  });
}

/**
 * The script's source-text pins. A fixture that imported a job name would
 * follow a rename, so the table's key-to-job binding is pinned on the source:
 * crossing the two watches' job names fails here even if every runtime
 * assertion were rewritten to match.
 */
export function scriptPinProblems(source) {
  const problems = [];
  for (const { key, jobName } of EXPECTED) {
    if (!new RegExp(`^  ${key}: \\{\\n    jobName: "${jobName}",$`, "m").test(source)) {
      problems.push(`WATCHES.${key} must stay bound to ${jobName}`);
    }
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
  const main = source.slice(source.indexOf("async function main()"));
  if (!/resolveWatch\(process\.env\.BACKUP_WATCH\)/.test(main)) {
    problems.push("main() must pick its watch from BACKUP_WATCH");
  }
  // main() is never run by a test, so nothing else sees it hand a fixed watch
  // to the reader or the alert: the Storage workflow would then judge the dump
  // and open or close the Storage alert on it.
  if (!/readBackupFreshness\(\{\s*watch,/.test(main) || !/runWatchdog\(\{\s*watch,/.test(main) || /\bWATCHES\b/.test(main)) {
    problems.push("main() must pass the watch it resolved, and name no watch itself");
  }
  // The production exit path. `--probe-only`'s exit is pinned separately, but
  // this line is the ONLY thing that turns a FAIL verdict into a red Actions
  // run — the workflows invoke the script with no flags. Mutating it to
  // `process.exit(0)` left every test green while the watch reported success
  // forever with the job stale. Verified by mutation.
  if (!/process\.exit\(\s*watchdog\.outcome === "pass" \? 0 : 1\s*\)/.test(source)) {
    problems.push("main() must exit non-zero on a non-pass verdict");
  }
  return problems;
}

/** One watch's workflow, judged against that watch's EXPECTED row. */
export function watchdogWorkflowProblems(yaml, expected) {
  const live = uncommented(yaml);
  const problems = [];
  if (/^\s*environment:\s/m.test(live)) {
    problems.push("must not name a GitHub environment");
  }
  if (/environment:\s*production-backup/.test(live)) {
    problems.push("must not name environment: production-backup");
  }
  if (installsDependenciesIn(live)) {
    problems.push("must not npm ci");
  }
  if (/pull_request:/.test(yaml)) {
    problems.push("must not be a pull_request check");
  }
  if (!cronPattern(expected.cron).test(live)) {
    problems.push(`cron must stay ${expected.slot}`);
  }
  for (const { cron, slot } of expected.forbiddenCrons) {
    if (cronPattern(cron).test(live)) {
      problems.push(`must not sit at ${slot}`);
    }
  }
  const watches = watchesGivenToScript(yaml);
  if (watches.length === 0 || watches.some((watch) => watch !== expected.key)) {
    problems.push(`must run the ${expected.key} watch: BACKUP_WATCH reaching the script step is ${JSON.stringify(watches)}`);
  }
  if (!/run: node scripts\/ci\/production-backup-freshness\.mjs$/m.test(live)) {
    problems.push("must run scripts/ci/production-backup-freshness.mjs with no flags");
  }
  return problems;
}

const script = readFileSync(SCRIPT, "utf8");

for (const expected of EXPECTED) {
  const workflowPath = join(WORKFLOWS_DIR, expected.workflow);
  const workflow = readFileSync(workflowPath, "utf8");
  const liveYaml = uncommented(workflow);

  describe(`${expected.key} watch: workflow wiring`, () => {
    const routing = readFileSync(ALERT_ROUTING, "utf8");
    const infra = readFileSync(AGENT_INFRA, "utf8");
    const roster = readFileSync(REQUIRED_CHECKS, "utf8");

    it("does not name a GitHub environment", () => {
      assert.doesNotMatch(liveYaml, /^\s*environment:\s/m);
      assert.doesNotMatch(liveYaml, /environment:\s*production/);
      assert.doesNotMatch(liveYaml, /environment:\s*["']production/);
    });

    it("is schedule + workflow_dispatch only — not a required PR check", () => {
      assert.match(liveYaml, cronPattern(expected.cron));
      assert.match(workflow, /workflow_dispatch:/);
      assert.doesNotMatch(workflow, /pull_request:/);
      assert.ok(!roster.includes(expected.workflow.replace(/\.yml$/, "")));
    });

    it(`no other daily schedule shares ${expected.slot}`, () => {
      for (const file of workflowFiles()) {
        if (file === expected.workflow) continue;
        const text = uncommented(readFileSync(join(WORKFLOWS_DIR, file), "utf8"));
        assert.doesNotMatch(text, cronPattern(expected.cron), `${file} collides with ${expected.workflow} at ${expected.slot} UTC`);
      }
    });

    it("does not change db-backup.yml cron", () => {
      const backup = uncommented(readFileSync(join(WORKFLOWS_DIR, "db-backup.yml"), "utf8"));
      assert.match(backup, /cron:\s*"30 6 \* \* \*"/);
    });

    it("alert-routing.md lists this alert title so the roster cannot drop it again", () => {
      assert.ok(
        routing.includes(expected.title),
        "alert-routing.md must name the alert; #1674 was this exact miss for guardrails",
      );
    });

    it("agent-infra.md roster and scheduled table name this workflow and its slot", () => {
      assert.ok(infra.includes(expected.workflow));
      assert.ok(infra.includes(`| ${expected.slot} | \`${expected.workflow}\``));
    });

    it("the live watchdog YAML stays clean and runs this watch", () => {
      assert.deepEqual(watchdogWorkflowProblems(workflow, expected), []);
    });

    it("passes no GITHUB_PAT and runs with no npm ci", () => {
      // #2518: this job names no environment, so a PAT here could only be a
      // repository secret, and a repository secret is readable from any branch.
      // The script still honours GITHUB_PAT for a local run.
      assert.doesNotMatch(liveYaml, /secrets\.GITHUB_PAT/);
      assert.ok(!installsDependenciesIn(liveYaml), "installs dependencies (npm ci, or node-setup `install: ci`)");
    });

    it("scopes issues: write to the job, not the workflow", () => {
      const workflowGrant = workflow.slice(workflow.indexOf("permissions:"), workflow.indexOf("concurrency:"));
      assert.match(workflowGrant, /contents: read/);
      assert.doesNotMatch(workflowGrant, /issues: write/);
      assert.doesNotMatch(workflowGrant, /actions: read/);
      assert.match(liveYaml, /issues: write/);
      assert.match(liveYaml, /actions: read/);
    });
  });

  describe(`${expected.key} watch: workflow mutations`, () => {
    const other = EXPECTED.find((e) => e.key !== expected.key);
    const fails = (mutated, pattern) => {
      assert.notEqual(mutated, workflow, "the mutation did not apply");
      const problems = watchdogWorkflowProblems(mutated, expected);
      assert.ok(problems.some((problem) => pattern.test(problem)), problems.join("; "));
    };

    it(`pointing it at the ${other.key} watch fails`, () => {
      fails(workflow.replace(`BACKUP_WATCH: ${expected.key}`, `BACKUP_WATCH: ${other.key}`), /BACKUP_WATCH reaching the script step/);
    });

    it("dropping BACKUP_WATCH fails", () => {
      fails(workflow.replace(/^\s*BACKUP_WATCH: .*\n/m, ""), /BACKUP_WATCH reaching the script step/);
    });

    it("naming environment: production-backup on the watchdog fails", () => {
      const problems = watchdogWorkflowProblems(`${workflow}\n    environment: production-backup\n`, expected);
      assert.ok(problems.some((problem) => problem.includes("production-backup")), problems.join("; "));
    });

    it("adding npm ci fails", () => {
      const problems = watchdogWorkflowProblems(`${workflow}\n      - run: npm ci\n`, expected);
      assert.ok(problems.some((problem) => problem.includes("npm ci")), problems.join("; "));
    });

    it("switching node-setup to an installing mode fails", () => {
      fails(workflow.replace(/install: none/, "install: ci"), /npm ci/);
    });

    it("adding a slot it must not take fails, even beside its own", () => {
      // Added, not swapped: swapping also drops its own cron, which fails on
      // that alone and would hide a deleted forbidden-slot check.
      const own = `- cron: "${expected.cron}"`;
      for (const { cron, slot } of expected.forbiddenCrons) {
        fails(workflow.replace(own, `${own}\n    - cron:  "${cron}"`), new RegExp(`must not sit at ${slot}`));
      }
    });

    it("moving BACKUP_WATCH off the step that runs the script fails", () => {
      const moved = workflow
        .replace(/^\s*BACKUP_WATCH: .*\n/m, "")
        .replace("install: none", `install: none\n        env:\n          BACKUP_WATCH: ${expected.key}`);
      fails(moved, /BACKUP_WATCH reaching the script step/);
    });
  });
}

describe("the script's wiring", () => {
  it("never PUTs an environment or a workflow", () => {
    assert.doesNotMatch(script, /method:\s*["']PUT["']/);
    assert.doesNotMatch(script, /\/environments\//);
  });

  it("refuses a GitHub closer in its alert copy", () => {
    assert.doesNotMatch(script, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
  });

  it("pins each watch's job, the main branch, and the 36h / 3h windows", () => {
    assert.deepEqual(scriptPinProblems(script), []);
  });

  it("resolves its watch, then a GitHub token, before the Actions GET", () => {
    const main = script.slice(script.indexOf("async function main()"));
    const watchIdx = main.indexOf("resolveWatch(process.env.BACKUP_WATCH)");
    const tokenIdx = main.indexOf("resolveActionsReadToken");
    const readIdx = main.indexOf("await readBackupFreshness");
    assert.ok(watchIdx !== -1, "main() must resolve its watch");
    assert.ok(tokenIdx !== -1, "main() must resolve an Actions-read token");
    assert.ok(readIdx !== -1, "main() must GET the backup runs");
    assert.ok(watchIdx < readIdx && tokenIdx < readIdx, "a missing watch or token must not look like a successful watch");
  });

  it("skips the alert write on --probe-only", () => {
    const main = script.slice(script.indexOf("async function main()"));
    const probeIdx = main.indexOf('process.argv.includes("--probe-only")');
    const writeIdx = main.indexOf("await runWatchdog");
    assert.ok(probeIdx !== -1 && writeIdx !== -1);
    assert.ok(probeIdx < writeIdx);
    assert.match(main, /if \(probeOnly\) \{\s*process\.exit\(verdict\.ok \? 0 : 1\);/s);
  });
});

describe("script mutations", () => {
  const fails = (mutated, pattern) => {
    assert.notEqual(mutated, script, "the mutation did not apply");
    const problems = scriptPinProblems(mutated);
    assert.ok(problems.some((problem) => pattern.test(problem)), problems.join("; "));
  };

  it("crossing the two watches' jobs fails", () => {
    const crossed = script
      .replace('    jobName: "backup-production-storage",', "    jobName: \"__storage__\",")
      .replace('    jobName: "backup-production",', '    jobName: "backup-production-storage",')
      .replace('    jobName: "__storage__",', '    jobName: "backup-production",');
    fails(crossed, /WATCHES\.dump/);
    fails(crossed, /WATCHES\.storage/);
  });

  it("pointing the dump watch at the Storage job fails", () => {
    fails(script.replace('    jobName: "backup-production",', '    jobName: "backup-production-storage",'), /WATCHES\.dump/);
  });

  it("making main() always exit 0 fails", () => {
    fails(script.replace('process.exit(watchdog.outcome === "pass" ? 0 : 1)', "process.exit(0)"), /exit non-zero/);
  });

  it("dropping the main-branch scope fails", () => {
    fails(script.replace('export const DEFAULT_BRANCH = "main"', 'export const DEFAULT_BRANCH = "production"'), /main/);
  });

  it("widening the stale window past 36h fails", () => {
    fails(
      script.replace("export const STALE_AFTER_MS = 36 * 60 * 60 * 1000", "export const STALE_AFTER_MS = 72 * 60 * 60 * 1000"),
      /36h/,
    );
  });

  it("hard-coding the runs page size fails", () => {
    fails(script.replace("per_page=${RUNS_PER_PAGE}", "per_page=10"), /RUNS_PER_PAGE/);
  });

  it("printing the verdict by hand fails", () => {
    fails(script.replace("verdictLogLine(verdict)", "`✅ ${verdict.reason}`"), /verdictLogLine/);
  });

  it("dropping the in-flight fresh gate fails", () => {
    fails(script.replace("if (!verdict.fresh)", "if (false)"), /in-flight/);
  });

  it("main() reading or alerting with a fixed watch fails", () => {
    const main = script.indexOf("async function main()");
    const inMain = (from, to) => script.slice(0, main) + script.slice(main).replace(from, to);
    fails(inMain("readBackupFreshness({\n    watch,", "readBackupFreshness({\n    watch: WATCHES.dump,"), /name no watch/);
    fails(inMain("runWatchdog({\n    watch,", "runWatchdog({\n    watch: WATCHES.storage,"), /name no watch/);
  });

  it("defaulting the watch fails", () => {
    fails(script.replace("resolveWatch(process.env.BACKUP_WATCH)", 'resolveWatch(process.env.BACKUP_WATCH ?? "dump")'), /BACKUP_WATCH/);
  });
});

describe("leftover lock hygiene", () => {
  it("refuses a GitHub closer next to an issue number", () => {
    const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
    for (const [rel, source] of [
      ["test", lock],
      ["script", script],
      ...EXPECTED.map((e) => [e.workflow, readFileSync(join(WORKFLOWS_DIR, e.workflow), "utf8")]),
    ]) {
      assert.doesNotMatch(source, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i, rel);
    }
  });
});

describe("main() annotates an unreadable tracker as could-not-read, never could-not-close", () => {
  // The annotation lives in main(), which no test runs. Reverting it to a
  // ::warning:: plus a false "could not be closed" error left every other
  // test green.
  const main = script.slice(script.indexOf("async function main()"));

  it("errors, not warns, when the alert issues could not be read", () => {
    assert.match(main, /console\.error\("::error::Could not read the alert issues, so no alert was closed this run"\)/);
    assert.doesNotMatch(main, /::warning::Could not read the alert issues/);
  });

  it("prints 'could not be closed' only when the lookup worked", () => {
    const unread = main.indexOf("watchdog.lookupOk === false");
    const closed = main.indexOf("could not be closed");
    assert.ok(unread !== -1 && closed > unread);
    assert.match(main.slice(unread, closed), /\} else if \(/);
  });
});
