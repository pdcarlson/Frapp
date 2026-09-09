import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_ISSUE_TITLE,
  ENV_NAME,
  evaluateBackupEnv,
  readBackupEnv,
  resolveAlertToken,
  resolveEnvReadToken,
  runWatchdog,
} from "../production-backup-env.mjs";

import { makeFetchMock } from "./helpers.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "production-backup-env.yml");
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "production-backup-env.mjs");
const ALERT_ROUTING = join(REPO_ROOT, "docs", "internal", "ops", "ALERT_ROUTING.md");
const AGENT_INFRA = join(REPO_ROOT, "docs", "internal", "ci-cd", "AGENT_INFRA.md");
const REQUIRED_CHECKS = join(REPO_ROOT, "scripts", "ci", "lib", "required-checks.mjs");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

function uncommented(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const CLEAR_BODY = {
  name: ENV_NAME,
  protection_rules: [],
  deployment_branch_policy: null,
};

describe("resolveEnvReadToken / resolveAlertToken", () => {
  it("prefers GITHUB_PAT for the Environments GET", () => {
    assert.equal(resolveEnvReadToken({ GITHUB_PAT: "pat", GITHUB_TOKEN: "tok" }), "pat");
    assert.equal(resolveEnvReadToken({ GITHUB_TOKEN: "tok" }), "tok");
    assert.equal(resolveEnvReadToken({}), "");
  });

  it("prefers GITHUB_TOKEN for the alert issue", () => {
    assert.equal(resolveAlertToken({ GITHUB_PAT: "pat", GITHUB_TOKEN: "tok" }), "tok");
    assert.equal(resolveAlertToken({ GITHUB_PAT: "pat" }), "pat");
    assert.equal(resolveAlertToken({}), "");
  });
});

describe("evaluateBackupEnv", () => {
  it("passes empty protection_rules even when deployment_branch_policy is null", () => {
    assert.deepEqual(evaluateBackupEnv({ status: 200, body: CLEAR_BODY }), {
      ok: true,
      reason: `${ENV_NAME} has no required reviewers or wait timer`,
    });
  });

  it("passes when a main-only branch policy is set — that leftover is not this watch", () => {
    const verdict = evaluateBackupEnv({
      status: 200,
      body: {
        ...CLEAR_BODY,
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
    });
    assert.equal(verdict.ok, true);
  });

  it("fails required_reviewers even with an empty reviewers list", () => {
    const verdict = evaluateBackupEnv({
      status: 200,
      body: {
        ...CLEAR_BODY,
        protection_rules: [{ type: "required_reviewers", reviewers: [] }],
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /required_reviewers/);
  });

  it("fails a wait_timer rule", () => {
    const verdict = evaluateBackupEnv({
      status: 200,
      body: {
        ...CLEAR_BODY,
        protection_rules: [{ type: "wait_timer", wait_timer: 30 }],
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /wait_timer/);
  });

  it("fails the string-summary shape GitHub sometimes returns in listings", () => {
    const verdict = evaluateBackupEnv({
      status: 200,
      body: { ...CLEAR_BODY, protection_rules: ["required_reviewers"] },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /required_reviewers/);
  });

  it("fails HTTP 403 as unreadable, not as a pass", () => {
    const verdict = evaluateBackupEnv({ status: 403, body: { message: "Forbidden" } });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /unreadable \(HTTP 403\)/);
  });

  it("fails a missing environment", () => {
    const verdict = evaluateBackupEnv({ status: 404, body: { message: "Not Found" } });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /missing/);
  });

  it("fails when protection_rules is not an array", () => {
    const verdict = evaluateBackupEnv({
      status: 200,
      body: { name: ENV_NAME, protection_rules: { type: "required_reviewers" } },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /protection_rules unreadable/);
  });
});

describe("readBackupEnv", () => {
  it("GETs /environments/production-backup and evaluates the body", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: `/environments/${ENV_NAME}`,
        body: CLEAR_BODY,
      },
    ]);
    const verdict = await readBackupEnv({
      token: "t",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(verdict.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/environments\/production-backup$/);
  });

  it("treats a 403 GET as unreadable", async () => {
    const { fetchImpl } = makeFetchMock([
      { method: "GET", path: `/environments/${ENV_NAME}`, status: 403, body: {} },
    ]);
    const verdict = await readBackupEnv({
      token: "t",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /unreadable \(HTTP 403\)/);
  });

  it("retries with fallbackToken after 401 and uses the second body", async () => {
    const responses = [
      { status: 401, body: {} },
      { status: 200, body: CLEAR_BODY },
    ];
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const res = responses[calls.length] ?? { status: 500, body: {} };
      calls.push({ method: init.method ?? "GET", url });
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        text: async () => JSON.stringify(res.body),
      };
    };
    const verdict = await readBackupEnv({
      token: "pat",
      fallbackToken: "tok",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(verdict.ok, true);
    assert.equal(calls.length, 2);
  });

  it("does not retry a 500 even when a fallback token is present", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: `/environments/${ENV_NAME}`, status: 500, body: {} },
    ]);
    const verdict = await readBackupEnv({
      token: "pat",
      fallbackToken: "tok",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /unreadable \(HTTP 500\)/);
    assert.equal(calls.length, 1);
  });

  it("does not retry a 200 that already found reviewers", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: `/environments/${ENV_NAME}`,
        status: 200,
        body: { ...CLEAR_BODY, protection_rules: [{ type: "required_reviewers" }] },
      },
    ]);
    const verdict = await readBackupEnv({
      token: "pat",
      fallbackToken: "tok",
      repo: "org/repo",
      fetchImpl,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /required_reviewers/);
    assert.equal(calls.length, 1);
  });
});

describe("runWatchdog", () => {
  const failVerdict = {
    ok: false,
    reason: `${ENV_NAME} has protection: required_reviewers`,
  };
  const passVerdict = {
    ok: true,
    reason: `${ENV_NAME} has no required reviewers or wait timer`,
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
    assert.doesNotMatch(createdBody.body, /\b(fixes|closes|close)\s+#/i);
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

describe("workflow wiring", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const liveYaml = uncommented(workflow);
  const script = readFileSync(SCRIPT, "utf8");
  const routing = readFileSync(ALERT_ROUTING, "utf8");
  const infra = readFileSync(AGENT_INFRA, "utf8");
  const roster = readFileSync(REQUIRED_CHECKS, "utf8");

  it("does not name environment: production or production-backup", () => {
    assert.doesNotMatch(liveYaml, /^\s*environment:\s/m);
    assert.doesNotMatch(liveYaml, /environment:\s*production/);
    assert.doesNotMatch(liveYaml, /environment:\s*["']production/);
    assert.doesNotMatch(liveYaml, /environment:\s*production-backup/);
    assert.doesNotMatch(liveYaml, /environment:\s*["']production-backup["']/);
  });

  it("is schedule + workflow_dispatch only — not a required PR check", () => {
    assert.match(workflow, /cron: "15 6 \* \* \*"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /pull_request:/);
    assert.doesNotMatch(roster, /production-backup-env/);
  });

  it("no other daily schedule shares 06:15", () => {
    for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))) {
      if (file === "production-backup-env.yml") continue;
      const text = uncommented(readFileSync(join(WORKFLOWS_DIR, file), "utf8"));
      assert.doesNotMatch(
        text,
        /cron:\s*"15 6 \* \* \*"/,
        `${file} collides with production-backup-env.yml at 06:15 UTC`,
      );
    }
  });

  it("does not collide with db-backup.yml at 06:30", () => {
    const backup = uncommented(
      readFileSync(join(WORKFLOWS_DIR, "db-backup.yml"), "utf8"),
    );
    assert.match(backup, /cron:\s*"30 6 \* \* \*"/);
    assert.doesNotMatch(liveYaml, /cron:\s*"30 6 \* \* \*"/);
  });

  it("never PUTs the environment", () => {
    assert.doesNotMatch(script, /method:\s*["']PUT["']/);
    assert.doesNotMatch(script, /method:\s*["']PATCH["']/);
    assert.match(script, /\/environments\/\$\{encodeURIComponent\(ENV_NAME\)\}/);
  });

  it("ALERT_ROUTING.md lists this alert title so the roster cannot drop it again", () => {
    assert.ok(
      routing.includes(ALERT_ISSUE_TITLE),
      "ALERT_ROUTING.md must name the new alert; #1674 was this exact miss for guardrails",
    );
  });

  it("AGENT_INFRA.md roster and scheduled table name this job", () => {
    assert.match(infra, /production-backup-env\.yml/);
    assert.match(infra, /06:15/);
  });

  it("the script refuses a GitHub closer in its alert copy", () => {
    assert.doesNotMatch(script, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
  });

  it("requires a GitHub token before the Environments GET", () => {
    const main = script.slice(script.indexOf("async function main()"));
    const tokenIdx = main.indexOf("resolveEnvReadToken");
    const readIdx = main.indexOf("await readBackupEnv");
    assert.ok(tokenIdx !== -1, "main() must resolve an env-read token");
    assert.ok(readIdx !== -1, "main() must GET the environment");
    assert.ok(tokenIdx < readIdx, "a missing token must not look like a successful watch");
  });

  it("passes GITHUB_PAT and runs with no npm ci", () => {
    assert.ok(
      workflow.includes("GITHUB_PAT: ${{ secrets.GITHUB_PAT }}"),
      "Environments GET needs the PAT; GITHUB_TOKEN often 403s",
    );
    assert.match(liveYaml, /node scripts\/ci\/production-backup-env\.mjs/);
    assert.doesNotMatch(liveYaml, /npm ci/);
  });

  it("scopes issues: write to the job, not the workflow", () => {
    const workflowGrant = workflow.slice(
      workflow.indexOf("permissions:"),
      workflow.indexOf("concurrency:"),
    );
    assert.match(workflowGrant, /contents: read/);
    assert.doesNotMatch(workflowGrant, /issues: write/);
    assert.match(liveYaml, /issues: write/);
  });
});

/**
 * Job-level `environment:` is indented four spaces. Action inputs live under
 * `with:` at ten. Collapsing those would let a "fix" that points the dump
 * jobs at GitHub `production` (the #1435 trap) hide behind the action's
 * `environment: production` source slug, which must stay.
 */
function githubJobEnvironments(yaml) {
  const jobs = {};
  let current = null;
  for (const line of uncommented(yaml).split("\n")) {
    const header = line.match(/^  ([a-z][a-z0-9-]*):\s*$/);
    if (header) {
      current = header[1];
      continue;
    }
    const env = line.match(/^    environment:\s*(\S+)\s*$/);
    if (env && current) jobs[current] = env[1];
  }
  return jobs;
}

describe("db-backup.yml GitHub environments", () => {
  const backup = readFileSync(join(WORKFLOWS_DIR, "db-backup.yml"), "utf8");
  const jobs = githubJobEnvironments(backup);

  it("runs both production dump jobs under production-backup, never production", () => {
    assert.equal(jobs["backup-production"], "production-backup");
    assert.equal(jobs["backup-production-storage"], "production-backup");
    assert.equal(
      Object.values(jobs).filter((name) => name === "production").length,
      0,
      "a job-level environment: production would suspend the nightly dump on the reviewer gate",
    );
  });

  it("keeps staging jobs on staging and still passes production as the dump source slug", () => {
    assert.equal(jobs["backup-staging"], "staging");
    assert.equal(jobs["backup-staging-storage"], "staging");
    assert.match(
      uncommented(backup),
      /^          environment:\s*production\s*$/m,
      "the offsite-backup action must still receive the production source slug",
    );
  });
});
