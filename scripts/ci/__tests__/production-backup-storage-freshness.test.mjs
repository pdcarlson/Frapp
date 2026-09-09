import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_ISSUE_TITLE,
  HUNG_AFTER_MS,
  PRODUCTION_JOB_NAME,
  STALE_AFTER_MS,
  WORKFLOW_FILE,
  evaluateDumpFreshness,
  readDumpFreshness,
  resolveActionsFallbackToken,
  resolveActionsReadToken,
  runWatchdog,
} from "../production-backup-storage-freshness.mjs";

import { makeFetchMock } from "./helpers.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "production-backup-storage-freshness.yml");
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "production-backup-storage-freshness.mjs");
const ALERT_ROUTING = join(REPO_ROOT, "docs", "internal", "ops", "ALERT_ROUTING.md");
const AGENT_INFRA = join(REPO_ROOT, "docs", "internal", "ci-cd", "AGENT_INFRA.md");
const REQUIRED_CHECKS = join(REPO_ROOT, "scripts", "ci", "lib", "required-checks.mjs");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

const NOW = Date.parse("2026-09-09T13:30:00Z");
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

function evaluate(overrides = {}) {
  return evaluateDumpFreshness({
    runsStatus: 200,
    runs: [{ id: 1, status: "completed", created_at: hoursAgo(16) }],
    jobsStatus: 200,
    jobs: [successJob()],
    now: NOW,
    ...overrides,
  });
}

describe("evaluateDumpFreshness", () => {
  it("passes a success younger than 36h", () => {
    const verdict = evaluate();
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /succeeded within 36h/);
  });

  it("fails a success older than 36h", () => {
    const verdict = evaluate({
      runs: [{ id: 1, status: "completed", created_at: hoursAgo(40) }],
      jobs: [successJob({ hours: 40 })],
    });
    assert.equal(verdict.ok, false);
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
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /concluded failure/);
  });

  it("fails a missing backup-production-storage job on a completed run", () => {
    const verdict = evaluate({
      jobs: [{ name: "backup-staging", status: "completed", conclusion: "success" }],
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

  it("passes an in-flight job younger than 3h", () => {
    const verdict = evaluate({
      runs: [{ id: 1, status: "in_progress", created_at: hoursAgo(1) }],
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
      runs: [{ id: 1, status: "queued", created_at: hoursAgo(0.5) }],
      jobs: [],
    });
    assert.equal(verdict.ok, true);
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

describe("runWatchdog", () => {
  const failVerdict = {
    ok: false,
    reason: "last backup-production-storage success is older than 36h",
  };
  const passVerdict = {
    ok: true,
    reason: "backup-production-storage succeeded within 36h",
  };

  it("creates a P1 routine-state alert and refuses a GitHub closer", async () => {
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
    assert.ok(createdBody.labels.includes("routine-state"));
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
});

function uncommented(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
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
    assert.match(workflow, /cron: "30 13 \* \* \*"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /pull_request:/);
    assert.doesNotMatch(roster, /production-backup-storage-freshness/);
  });

  it("no other daily schedule shares 13:30", () => {
    for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))) {
      if (file === "production-backup-storage-freshness.yml") continue;
      const text = uncommented(readFileSync(join(WORKFLOWS_DIR, file), "utf8"));
      assert.doesNotMatch(
        text,
        /cron:\s*"30 13 \* \* \*"/,
        `${file} collides with production-backup-storage-freshness.yml at 13:30 UTC`,
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
    assert.match(infra, /production-backup-storage-freshness\.yml/);
    assert.match(infra, /13:30/);
  });

  it("the script refuses a GitHub closer in its alert copy", () => {
    assert.doesNotMatch(script, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
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

  it("passes GITHUB_PAT and runs with no npm ci", () => {
    assert.ok(
      workflow.includes("GITHUB_PAT: ${{ secrets.GITHUB_PAT }}"),
      "Actions GET falls back to the PAT when GITHUB_TOKEN is 401/403",
    );
    assert.match(liveYaml, /node scripts\/ci\/production-backup-storage-freshness\.mjs/);
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
