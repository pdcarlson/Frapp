import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { WORKFLOW_DIR, workflowFiles, workflowJobs, workflowKeys, workflowSteps } from "./helpers/workflow-yaml.mjs";
import { ALL_REQUIRED_CHECKS, MERGE_QUEUE } from "../lib/required-checks.mjs";

// The merge queue on `main` (#4795) waits for every required check to report
// on the queue's own test commit, which only a workflow listening for
// `merge_group` produces. A required check in a workflow without that trigger
// never reports there: every queued PR then sits until the queue's timeout and
// drops out, and nothing in a PR's own checks shows why. These pin the parts of
// ci.yml and migration-drift-gate.yml that make a queue run check what a PR
// run checks, measured from the entry ahead instead of the PR's base.

const files = workflowFiles().map((name) => ({ name, path: join(WORKFLOW_DIR, name) }));

/** Workflows with at least one job whose check run is a required check. */
const emitting = files
  .map((file) => ({
    ...file,
    required: workflowJobs(file.path)
      .map((job) => job.jobId)
      .filter((id) => ALL_REQUIRED_CHECKS.includes(id)),
  }))
  .filter((file) => file.required.length > 0);

describe("merge queue triggers", () => {
  it("finds every required check in some workflow", () => {
    const found = new Set(emitting.flatMap((file) => file.required));
    const missing = ALL_REQUIRED_CHECKS.filter((name) => !found.has(name));
    assert.deepEqual(missing, [], "a required check no workflow job emits can never pass");
  });

  for (const file of emitting) {
    it(`${file.name} listens for merge_group (it emits ${file.required.join(", ")})`, () => {
      const on = workflowKeys(file.path).get("on");
      assert.ok(on instanceof Map, `${file.name} has a mapping under on:`);
      assert.ok(on.has("merge_group"), `${file.name} has no merge_group trigger`);
    });
  }

  it("the roster declares the queue settings this repo depends on", () => {
    assert.equal(MERGE_QUEUE?.merge_method, "SQUASH");
    assert.equal(MERGE_QUEUE?.grouping_strategy, "ALLGREEN");
    // migration-replay's timeout is the slowest required job's ceiling.
    const replay = workflowJobs(join(WORKFLOW_DIR, "migration-drift-gate.yml")).find(
      (job) => job.jobId === "migration-replay",
    );
    const replayTimeout = Number(replay.keys.get("timeout-minutes"));
    assert.ok(
      MERGE_QUEUE.check_response_timeout_minutes > replayTimeout,
      `the queue's ${MERGE_QUEUE.check_response_timeout_minutes}-minute timeout must outlast migration-replay's ${replayTimeout}`,
    );
  });
});

describe("a queue run is not a pull_request run", () => {
  for (const file of emitting) {
    const text = readFileSync(file.path, "utf8");

    it(`${file.name}: no required job is skipped in the queue by a push-only arm`, () => {
      // A job-level `if:` that skips reports Success, so a job written as
      // `event_name == 'push'` alone would pass in the queue unrun. The one
      // allowed push arm is a gated job's, ORed with a path filter that runs
      // in the queue (the exact form is pinned below).
      for (const job of workflowJobs(file.path)) {
        if (!ALL_REQUIRED_CHECKS.includes(job.jobId) || job.if === null) continue;
        assert.doesNotMatch(
          job.if.replace(/github\.event_name == 'push' \|\| needs\.changes\.outputs\.(?!(?:queue_tested|skip_suite)\b)\w+ == 'true'/, ""),
          /event_name\s*==\s*'push'/,
          `${job.jobId}: a push-only arm skips it in the queue`,
        );
        assert.doesNotMatch(
          job.if,
          /event_name\s*!=\s*'merge_group'/,
          `${job.jobId} is required, so it must run in the queue`,
        );
      }
    });

    it(`${file.name}: every PR base read falls back to the queue's base`, () => {
      // `github.event.pull_request` is empty on merge_group, so a bare base read
      // hands a diff step an empty SHA there.
      const bare = text
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .filter((line) => line.includes("github.event.pull_request.base.sha"))
        .filter((line) => !line.includes("github.event.merge_group.base_sha"));
      assert.deepEqual(bare, [], "pair each with `|| github.event.merge_group.base_sha`");
    });
  }
});

describe("queue runs take the path and diff arms", () => {
  it("every path-gated job runs on a push, and on a PR or queue entry its filter matches", () => {
    // Exact form, not a denylist: `github.ref == 'refs/heads/main' || <filter>`
    // would skip a push the queue didn't test, and `event_name == 'pull_request'
    // && …` a queue entry. A queue entry's filter sees only its own PR (#5195):
    // its base is the entry ahead.
    for (const file of emitting) {
      for (const job of workflowJobs(file.path)) {
        if (job.if === null || !/needs\.changes\.outputs\.(?!(?:queue_tested|skip_suite)\b)/.test(job.if)) continue;
        // ci.yml ANDs `skip_suite` in front (#5084, #5141; queue-tested.test.mjs
        // and docs-only-skip.test.mjs); the path arm keeps this exact form
        // inside its parentheses.
        assert.match(
          job.if,
          /^\$\{\{ (needs\.changes\.outputs\.(?:queue_tested|skip_suite) != 'true' && \()?github\.event_name == 'push' \|\| needs\.changes\.outputs\.\w+ == 'true'(\))? \}\}$/,
          `${file.name} ${job.jobId}`,
        );
        assert.equal(/queue_tested|skip_suite/.test(job.if), /\)\s*\}\}$/.test(job.if), `${file.name} ${job.jobId}: parenthesize the path arm`);
      }
    }
  });

  it("the path filters run in the queue, and a failed one runs the jobs", () => {
    // The gated jobs read these outputs in the queue (above). The filter steps
    // carry `continue-on-error` there, which leaves a failed step's outputs
    // empty; each path output must then answer 'true', or every gated job
    // would skip and report Success.
    const ci = join(WORKFLOW_DIR, "ci.yml");
    const changes = workflowJobs(ci).find((job) => job.jobId === "changes");
    const outputs = changes.keys.get("outputs");
    const gated = new Set();
    for (const job of workflowJobs(ci)) {
      for (const m of (job.if ?? "").matchAll(/needs\.changes\.outputs\.(\w+) == 'true'/g)) gated.add(m[1]);
    }
    assert.ok(gated.size >= 5, `expected the gated jobs' outputs, saw ${[...gated]}`);
    for (const name of gated) {
      const value = outputs.get(name);
      // A top-level OR of arms, so the failure arm alone turns the job on.
      assert.doesNotMatch(value, /&&|!/, `${name}: OR its arms only`);
      const arms = value.replace(/^\$\{\{ | \}\}$/g, "").split(" || ");
      for (const id of ["filter", "apps"]) {
        if (!value.includes(`steps.${id}.outputs.`)) continue;
        assert.ok(arms.includes(`steps.${id}.outcome == 'failure'`), `${name} must run its jobs when ${id} fails`);
      }
    }
  });

  it("a job with a PR-only diff step also runs it in the queue", () => {
    // Otherwise both its PR step and its push step skip in the queue and the
    // job reports green having checked nothing.
    for (const file of emitting) {
      for (const step of workflowSteps(file.path)) {
        if (step.jobId === "changes") continue;
        const cond = step.body.match(/^\s*if:\s*(.+)$/m)?.[1] ?? "";
        if (!/event_name == 'pull_request'/.test(cond)) continue;
        assert.match(cond, /merge_group/, `${file.name} ${step.jobId}: "${step.name}" skips in the queue`);
      }
    }
  });

  it("the drift gate's did-migrations-change steps diff from a queue base", () => {
    // Without a merge_group arm the shell falls to the push branch with an empty
    // `before`, diffs `..HEAD` to nothing, and both required checks skip their work.
    const steps = workflowSteps(join(WORKFLOW_DIR, "migration-drift-gate.yml")).filter(
      (step) => step.name === "Does this change touch migrations?",
    );
    assert.deepEqual(steps.map((s) => s.jobId).sort(), ["migration-order", "migration-replay"]);
    for (const step of steps) {
      assert.match(step.body, /\[ "\$EVENT_NAME" = "merge_group" \]/, step.jobId);
    }
    // migration-order measures introduced migrations from main's tip in the
    // queue, so its touched diff must start there too, not at the entry ahead.
    const order = steps.find((s) => s.jobId === "migration-order");
    assert.match(order.body, /ORDER_BASE: \$\{\{ steps\.base\.outputs\.ref \}\}/);
    assert.match(order.body, /RANGE="\$ORDER_BASE\.\.\$HEAD_SHA"/);
  });
});
