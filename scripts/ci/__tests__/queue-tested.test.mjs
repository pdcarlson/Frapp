import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { WORKFLOW_DIR, workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";
import {
  candidateRuns,
  checkQueueTested,
  CI_WORKFLOW_FILE,
  requiredJobsPassed,
  runSucceeded,
} from "../queue-tested.mjs";
import { deployEvidenceByName } from "../lib/check-runs.mjs";
import { CI_CHECKS } from "../lib/required-checks.mjs";
import { classifyRequiredChecks } from "../validate-deploy-sha.mjs";

// #5084: a push to main whose commit the merge queue already passed skips the
// CI jobs, because the queue fast-forwarded main to the very commit it tested.
// These pin the parts that make that safe: the verdict only says "tested" when
// the queue's run of this exact SHA passed, a re-run always tests in full,
// every CI job but the ones that must run reads it, main's tool caches are
// still seeded, and the production deploy gate judges such a commit on the
// queue's real results rather than on the push run's skips.

const SHA = "07ed41126848a5a6d8427d2e797ee56ffa0e83ca";
const OTHER = "c5e0e92852513eee8c918601cefacc21c3a593dd";
const CI = join(WORKFLOW_DIR, "ci.yml");
const SCRIPT = fileURLToPath(new URL("../queue-tested.mjs", import.meta.url));

const queueRun = (over = {}) => ({
  id: 43730828577,
  event: "merge_group",
  head_sha: SHA,
  status: "completed",
  conclusion: "success",
  created_at: "2026-11-15T15:36:28Z",
  ...over,
});
const greenJobs = (names = CI_CHECKS) => names.map((name) => ({ name, status: "completed", conclusion: "success" }));

function okJson(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

const noRetry = { attempts: 1, sleep: async () => {}, timeoutMs: 1000 };

/** A fetch double answering the runs list and each run's jobs by URL. */
function fakeApi({ runs = [], jobsByRun = {}, fail = null } = {}) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (fail) return fail(url);
    const path = new URL(url).pathname;
    const jobsMatch = path.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if (jobsMatch) return okJson({ jobs: jobsByRun[jobsMatch[1]] ?? [] });
    return okJson({ workflow_runs: runs });
  };
  return { urls, fetchImpl };
}

const ask = (fetchImpl, over = {}) =>
  checkQueueTested({ eventName: "push", sha: SHA, runAttempt: "1", repo: "frapplive/Frapp", token: "t", fetchImpl, retryOptions: noRetry, ...over });

describe("which queue runs count", () => {
  it("only merge_group runs of the same commit, newest first", () => {
    const runs = candidateRuns({
      sha: SHA,
      runs: [
        queueRun({ id: 1, created_at: "2026-11-15T15:00:00Z" }),
        queueRun({ id: 2, head_sha: OTHER }),
        queueRun({ id: 3, event: "push" }),
        queueRun({ id: 4, event: "pull_request" }),
        queueRun({ id: 5, created_at: "2026-11-15T16:00:00Z" }),
      ],
    });
    assert.deepEqual(runs.map((r) => r.id), [5, 1]);
  });

  it("a whole run counts only completed and green", () => {
    assert.equal(runSucceeded(queueRun()), true);
    for (const over of [{ conclusion: "failure" }, { conclusion: "cancelled" }, { conclusion: "skipped" }, { status: "in_progress", conclusion: null }]) {
      assert.equal(runSucceeded(queueRun(over)), false, JSON.stringify(over));
    }
  });

  it("a run still finishing counts once every required CI job is green", () => {
    assert.equal(requiredJobsPassed(greenJobs()), true);
    const [first, ...rest] = CI_CHECKS;
    assert.equal(requiredJobsPassed(greenJobs(rest)), false, `${first} missing`);
    assert.equal(requiredJobsPassed([...greenJobs(rest), { name: first, status: "in_progress", conclusion: null }]), false);
    assert.equal(requiredJobsPassed([...greenJobs(rest), { name: first, status: "completed", conclusion: "failure" }]), false);
    assert.equal(requiredJobsPassed([...greenJobs(rest), { name: first, status: "completed", conclusion: "cancelled" }]), false);
    // An advisory job still running or red doesn't hold it back.
    assert.equal(requiredJobsPassed([...greenJobs(), { name: "duplicate-detection", status: "in_progress", conclusion: null }]), true);
  });
});

describe("checkQueueTested", () => {
  it("asks for this workflow's merge_group runs of the exact commit", async () => {
    const api = fakeApi({ runs: [queueRun()] });
    const verdict = await ask(api.fetchImpl);
    assert.equal(verdict.tested, true);
    assert.equal(verdict.runId, 43730828577);
    assert.equal(api.urls.length, 1, "a run that concluded success needs no jobs read");
    const url = new URL(api.urls[0]);
    assert.equal(url.pathname, `/repos/frapplive/Frapp/actions/workflows/${CI_WORKFLOW_FILE}/runs`);
    assert.equal(url.searchParams.get("event"), "merge_group");
    assert.equal(url.searchParams.get("head_sha"), SHA);
  });

  it("counts a queue run still finishing whose required jobs all passed (the queue merges then)", async () => {
    const api = fakeApi({
      runs: [queueRun({ status: "in_progress", conclusion: null })],
      jobsByRun: { 43730828577: [...greenJobs(), { name: "duplicate-detection", status: "in_progress", conclusion: null }] },
    });
    const verdict = await ask(api.fetchImpl);
    assert.equal(verdict.tested, true);
    assert.match(new URL(api.urls[1]).search, /filter=latest/);
  });

  it("does not count a queue run still finishing with a required job not yet green", async () => {
    const [first, ...rest] = CI_CHECKS;
    const api = fakeApi({
      runs: [queueRun({ status: "in_progress", conclusion: null })],
      jobsByRun: { 43730828577: [...greenJobs(rest), { name: first, status: "queued", conclusion: null }] },
    });
    assert.equal((await ask(api.fetchImpl)).tested, false);
  });

  it("does not count a queue run that concluded red, whatever its jobs say", async () => {
    const api = fakeApi({ runs: [queueRun({ conclusion: "failure" })], jobsByRun: { 43730828577: greenJobs() } });
    assert.equal((await ask(api.fetchImpl)).tested, false);
    assert.equal(api.urls.length, 1);
  });

  for (const [label, over] of Object.entries({
    "a pull_request run": { eventName: "pull_request" },
    "a merge_group run": { eventName: "merge_group" },
    "an unknown event": { eventName: undefined },
    "a re-run of the push run": { runAttempt: "2" },
    "a malformed SHA": { sha: "07ed411" },
  })) {
    it(`never skips, nor calls the API, on ${label}`, async () => {
      const api = fakeApi({ runs: [queueRun({ head_sha: over.sha ?? SHA })] });
      const verdict = await ask(api.fetchImpl, over);
      assert.equal(verdict.tested, false);
      assert.equal(api.urls.length, 0);
    });
  }

  const failures = {
    "an HTTP error": async () => ({ ok: false, status: 403, text: async () => '{"message":"Resource not accessible"}' }),
    "a network error": async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    },
    "a payload without workflow_runs": async () => okJson({ message: "odd" }),
    "an HTML error page": async () => ({ ok: true, status: 200, text: async () => "<html>bad gateway</html>" }),
  };
  for (const [label, fail] of Object.entries(failures)) {
    it(`reads ${label} as not tested, so the full suite runs`, async () => {
      const verdict = await ask(fakeApi({ fail }).fetchImpl);
      assert.equal(verdict.tested, false);
      assert.match(verdict.reason, /full suite/);
    });
  }

  it("reads an unreadable jobs list as not tested", async () => {
    const fetchImpl = async (url) =>
      /\/jobs/.test(url)
        ? { ok: false, status: 500, text: async () => "" }
        : okJson({ workflow_runs: [queueRun({ status: "in_progress", conclusion: null })] });
    assert.equal((await ask(fetchImpl)).tested, false);
  });
});

describe("the script's wiring to the workflow", () => {
  it("writes `tested=` to GITHUB_OUTPUT and exits 0 off a push", () => {
    const out = join(mkdtempSync(join(tmpdir(), "queue-tested-")), "output");
    execFileSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, EVENT_NAME: "pull_request", HEAD_SHA: SHA, RUN_ATTEMPT: "1", GITHUB_OUTPUT: out },
      stdio: "pipe",
    });
    assert.equal(readFileSync(out, "utf8"), "tested=false\n");
  });

  it("the step passes every input the script reads", () => {
    const step = workflowSteps(CI).find((s) => s.jobId === "changes" && /queue-tested\.mjs/.test(s.body));
    assert.ok(step, "changes runs scripts/ci/queue-tested.mjs");
    const script = readFileSync(SCRIPT, "utf8");
    const read = [...script.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
    // The runner sets these two itself.
    const fromRunner = new Set(["GITHUB_REPOSITORY", "GITHUB_OUTPUT"]);
    for (const name of new Set(read)) {
      if (fromRunner.has(name)) continue;
      assert.match(step.body, new RegExp(`^\\s*${name}:\\s*\\S`, "m"), `the step sets ${name}`);
    }
    assert.match(step.body, /EVENT_NAME:\s*\$\{\{ github\.event_name \}\}/);
    assert.match(step.body, /HEAD_SHA:\s*\$\{\{ github\.sha \}\}/);
    assert.match(step.body, /RUN_ATTEMPT:\s*\$\{\{ github\.run_attempt \}\}/);
    assert.match(step.body, /GITHUB_TOKEN:\s*\$\{\{ github\.token \}\}/);
  });
});

describe("ci.yml reads queue_tested", () => {
  const jobs = workflowJobs(CI);
  const byId = new Map(jobs.map((job) => [job.jobId, job]));
  // `changes` answers the question, and `packages-build` keeps seeding main's
  // node_modules and turbo caches, which PR runs restore and the queue's runs
  // can't write for them (a cache saved on a queue ref is scoped to that ref).
  const ALWAYS_RUN = ["changes", "packages-build"];

  it("changes and packages-build never read it, and never skip", () => {
    for (const id of ALWAYS_RUN) {
      const job = byId.get(id);
      assert.ok(job, `${id} exists`);
      assert.equal(job.if, null, `${id} must not carry a job-level if:`);
    }
  });

  // Runs only when the suite skipped: the inverse gate, and never a required check.
  const SEEDER = "main-caches";

  it(`${SEEDER} runs exactly when the suite skips, and is not required`, () => {
    const job = byId.get(SEEDER);
    assert.ok(job, `${SEEDER} exists`);
    assert.equal(job.if, "${{ needs.changes.outputs.queue_tested == 'true' }}");
    assert.ok(!CI_CHECKS.includes(SEEDER), "a job that skips on every PR and queue run can't gate a merge");
  });

  it(`${SEEDER} writes every tool cache key a skipped job used to write on main`, () => {
    const keysIn = (jobId) =>
      workflowSteps(CI)
        .filter((step) => step.jobId === jobId)
        .flatMap((step) => [...step.body.matchAll(/^\s*key:\s*(.+)$/gm)].map((m) => m[1].trim()));
    const seeded = new Set(keysIn(SEEDER));
    const usesOsDeps = (jobId) => workflowSteps(CI).some((step) => step.jobId === jobId && /playwright-os-deps/.test(step.body));
    for (const job of jobs) {
      if (ALWAYS_RUN.includes(job.jobId) || job.jobId === SEEDER) continue;
      for (const key of keysIn(job.jobId)) {
        assert.ok(seeded.has(key), `${job.jobId} saves "${key}", which ${SEEDER} must also write`);
      }
      if (usesOsDeps(job.jobId)) assert.ok(usesOsDeps(SEEDER), `${job.jobId} caches Playwright OS packages; ${SEEDER} must too`);
    }
    // And never pays a download for a key that is already there.
    for (const step of workflowSteps(CI).filter((s) => s.jobId === SEEDER && /actions\/cache@/.test(s.body))) {
      assert.match(step.body, /lookup-only:\s*true/, step.name);
    }
  });

  for (const job of jobs.filter((j) => !ALWAYS_RUN.includes(j.jobId) && j.jobId !== SEEDER)) {
    it(`${job.jobId} needs changes and skips on a queue-tested push`, () => {
      const needs = job.keys.get("needs") ?? "";
      assert.match(String(needs), /(^|[\s[,])changes([\s\],]|$)/, `${job.jobId} needs: changes`);
      assert.ok(job.if, `${job.jobId} has a job-level if:`);
      // The gate comes first and is ANDed, so it can't be bypassed by an `||`
      // arm, and every other condition keeps its own parentheses.
      assert.match(
        job.if,
        /^\$\{\{ needs\.changes\.outputs\.queue_tested != 'true'( && \(.+\))? \}\}$/,
        `${job.jobId}: if: \${{ needs.changes.outputs.queue_tested != 'true' [&& (…)] }}`,
      );
    });
  }

  it("changes exposes queue_tested as a strict 'true' from the queue step", () => {
    const outputs = byId.get("changes").keys.get("outputs");
    assert.ok(outputs instanceof Map, "changes has outputs");
    assert.equal(outputs.get("queue_tested"), "${{ steps.queue.outputs.tested == 'true' }}");
    const permissions = byId.get("changes").keys.get("permissions");
    assert.equal(permissions?.get("actions"), "read", "the runs API needs actions: read");
  });

  it("the queue step runs on push only and can never fail changes", () => {
    const steps = workflowSteps(CI).filter((step) => step.jobId === "changes");
    const queue = steps.find((step) => /queue-tested\.mjs/.test(step.body));
    assert.ok(queue, "changes runs scripts/ci/queue-tested.mjs");
    assert.match(queue.body, /^\s*id:\s*queue\s*$/m);
    assert.match(queue.body, /^\s*if:\s*github\.event_name == 'push'\s*$/m);
    assert.match(queue.body, /^\s*continue-on-error:\s*true\s*$/m);
    assert.match(queue.body, /HEAD_SHA:\s*\$\{\{ github\.sha \}\}/);
    // Its Node setup must not be able to fail changes either.
    const setup = steps.find((step) => /node-setup/.test(step.body));
    assert.ok(setup, "changes sets up Node for the script");
    assert.match(setup.body, /^\s*if:\s*github\.event_name == 'push'\s*$/m);
    assert.match(setup.body, /^\s*continue-on-error:\s*true\s*$/m);
  });
});

describe("deploy evidence on a queue-tested commit", () => {
  const required = ["api-tests", "web-tests"];
  const at = (minute) => `2026-11-15T15:${String(minute).padStart(2, "0")}:00Z`;
  const queue = (name, conclusion, minute = 30) => ({ name, status: "completed", conclusion, started_at: at(minute) });
  const pushSkip = (name, minute = 45) => ({ name, status: "completed", conclusion: "skipped", started_at: at(minute) });

  it("a push run's skip gives way to the queue's real result", () => {
    const evidence = deployEvidenceByName([queue("api-tests", "success"), pushSkip("api-tests")]);
    assert.equal(evidence.get("api-tests").conclusion, "success");
    assert.equal(evidence.get("api-tests").started_at, at(30));
  });

  it("accepts the commit when the queue passed it", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: required.flatMap((name) => [queue(name, "success"), pushSkip(name)]),
      required,
    });
    assert.equal(verdict.ok, true);
  });

  it("refuses the commit when the queue's run failed, a newer skip notwithstanding", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [queue("api-tests", "failure"), pushSkip("api-tests"), queue("web-tests", "success"), pushSkip("web-tests")],
      required,
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.failing, ["api-tests (failure)"]);
  });

  it("still takes the newest of the runs that ran, so a red re-run is not masked", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [queue("api-tests", "success", 20), queue("api-tests", "failure", 30), pushSkip("api-tests"), queue("web-tests", "success")],
      required,
    });
    assert.deepEqual(verdict.failing, ["api-tests (failure)"]);
  });

  it("a check that only ever skipped is judged skipped, as before", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [pushSkip("api-tests"), queue("web-tests", "success")],
      required,
    });
    assert.equal(verdict.ok, true);
  });

  it("a full push run still in progress is pending, not excused by a skip", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [
        { name: "api-tests", status: "in_progress", conclusion: null, started_at: at(50) },
        pushSkip("api-tests", 40),
        queue("web-tests", "success"),
      ],
      required,
    });
    assert.deepEqual(verdict.pending, ["api-tests (in_progress)"]);
  });
});
