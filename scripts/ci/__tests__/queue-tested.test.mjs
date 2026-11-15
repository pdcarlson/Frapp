import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { WORKFLOW_DIR, workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";
import { checkQueueTested, CI_WORKFLOW_FILE, queueTested } from "../queue-tested.mjs";
import { deployEvidenceByName } from "../lib/check-runs.mjs";
import { classifyRequiredChecks } from "../validate-deploy-sha.mjs";

// #5084: a push to main whose commit the merge queue already passed skips the
// CI jobs, because the queue fast-forwarded main to the very commit it tested.
// These pin the three parts that make that safe: the verdict only says "tested"
// for a green queue run of this exact SHA, every CI job but the two that must
// run reads it, and the production deploy gate judges such a commit on the
// queue's real results rather than on the push run's skips.

const SHA = "07ed41126848a5a6d8427d2e797ee56ffa0e83ca";
const OTHER = "c5e0e92852513eee8c918601cefacc21c3a593dd";
const CI = join(WORKFLOW_DIR, "ci.yml");

const queueRun = (over = {}) => ({
  id: 43730828577,
  event: "merge_group",
  head_sha: SHA,
  status: "completed",
  conclusion: "success",
  ...over,
});

function okJson(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

const noRetry = { attempts: 1, sleep: async () => {}, timeoutMs: 1000 };

describe("queueTested", () => {
  it("is true for a green merge_group run of the same commit on a push", () => {
    const verdict = queueTested({ eventName: "push", sha: SHA, runs: [queueRun()] });
    assert.equal(verdict.tested, true);
    assert.equal(verdict.runId, 43730828577);
  });

  for (const eventName of ["pull_request", "merge_group", "workflow_dispatch", undefined]) {
    it(`is false on ${eventName ?? "an unknown event"}, whatever the runs say`, () => {
      assert.equal(queueTested({ eventName, sha: SHA, runs: [queueRun()] }).tested, false);
    });
  }

  const notEvidence = {
    "another commit": { head_sha: OTHER },
    "a push run": { event: "push" },
    "a pull_request run": { event: "pull_request" },
    "a run still in progress": { status: "in_progress", conclusion: null },
    "a failed queue run": { conclusion: "failure" },
    "a cancelled queue run": { conclusion: "cancelled" },
    "a skipped queue run": { conclusion: "skipped" },
  };
  for (const [label, over] of Object.entries(notEvidence)) {
    it(`is false for ${label}, even if the API filter let it through`, () => {
      assert.equal(queueTested({ eventName: "push", sha: SHA, runs: [queueRun(over)] }).tested, false);
    });
  }

  it("is false with no runs, or a malformed SHA", () => {
    assert.equal(queueTested({ eventName: "push", sha: SHA, runs: [] }).tested, false);
    assert.equal(queueTested({ eventName: "push", sha: SHA, runs: null }).tested, false);
    assert.equal(queueTested({ eventName: "push", sha: "07ed411", runs: [queueRun({ head_sha: "07ed411" })] }).tested, false);
  });
});

describe("checkQueueTested", () => {
  it("asks for this workflow's successful merge_group runs of the exact commit", async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      return okJson({ workflow_runs: [queueRun()] });
    };
    const verdict = await checkQueueTested({
      eventName: "push",
      sha: SHA,
      repo: "frapplive/Frapp",
      token: "t",
      fetchImpl,
      retryOptions: noRetry,
    });
    assert.equal(verdict.tested, true);
    assert.equal(urls.length, 1);
    const url = new URL(urls[0]);
    assert.equal(url.pathname, `/repos/frapplive/Frapp/actions/workflows/${CI_WORKFLOW_FILE}/runs`);
    assert.equal(url.searchParams.get("event"), "merge_group");
    assert.equal(url.searchParams.get("head_sha"), SHA);
    assert.equal(url.searchParams.get("status"), "success");
  });

  it("never calls the API off a push", async () => {
    let called = false;
    const verdict = await checkQueueTested({
      eventName: "merge_group",
      sha: SHA,
      repo: "frapplive/Frapp",
      token: "t",
      fetchImpl: async () => {
        called = true;
        return okJson({ workflow_runs: [queueRun()] });
      },
    });
    assert.equal(verdict.tested, false);
    assert.equal(called, false);
  });

  const failures = {
    "an HTTP error": async () => ({ ok: false, status: 403, text: async () => '{"message":"Resource not accessible"}' }),
    "a network error": async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    },
    "a payload without workflow_runs": async () => okJson({ message: "odd" }),
    "an HTML error page": async () => ({ ok: true, status: 200, text: async () => "<html>bad gateway</html>" }),
  };
  for (const [label, fetchImpl] of Object.entries(failures)) {
    it(`reads ${label} as not tested, so the full suite runs`, async () => {
      const verdict = await checkQueueTested({
        eventName: "push",
        sha: SHA,
        repo: "frapplive/Frapp",
        token: "t",
        fetchImpl,
        retryOptions: noRetry,
      });
      assert.equal(verdict.tested, false);
      assert.match(verdict.reason, /full suite/);
    });
  }
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

  for (const job of jobs.filter((j) => !ALWAYS_RUN.includes(j.jobId))) {
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
