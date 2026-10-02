// Every job that runs on a runner sets `timeout-minutes` (#3129).
//
// Without one a job gets GitHub's 360-minute default. On `main` most of these
// workflows hold a concurrency group that never cancels in progress, so one
// hung job holds the lock for six hours and every later push's run is
// replaced while it waits: on 2026-10-01 a Playwright apt step hung `ci.yml`
// from 15:52 until it was cancelled by hand at ~18:20, and the three merges
// behind it never got required checks. A job stopped by its timeout ends
// `cancelled` (GitHub has no separate job conclusion for it), which frees the
// lock and can be re-run; a hung one starves the queue silently. CI wake names
// such a job as timed out rather than deliberately cancelled (#3162).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACTION_DIR,
  WORKFLOW_DIR,
  workflowFiles,
  workflowJobs,
  workflowSteps,
} from "./helpers/workflow-yaml.mjs";

/** GitHub's default, which is the hang this guards against. */
const GITHUB_DEFAULT_MINUTES = 360;

const minutes = (value) => {
  const text = String(value ?? "").trim();
  return /^[1-9][0-9]*$/.test(text) ? Number(text) : NaN;
};

describe("workflow job timeouts (#3129)", () => {
  const files = workflowFiles();

  it("reads the workflows it guards", () => {
    assert.ok(files.includes("ci.yml"), "ci.yml is among the workflows read");
    const ciJobs = workflowJobs(join(WORKFLOW_DIR, "ci.yml"));
    assert.ok(ciJobs.length >= 20, `ci.yml has ${ciJobs.length} jobs`);
  });

  it("gives every job that runs on a runner a literal timeout below GitHub's default", () => {
    const offenders = [];
    for (const file of files) {
      for (const job of workflowJobs(join(WORKFLOW_DIR, file))) {
        // A reusable-workflow call runs no steps of its own; the called
        // workflow's jobs carry the timeout, and are checked as its own file.
        if (job.keys.has("uses")) continue;
        const value = minutes(job.keys.get("timeout-minutes"));
        if (!(value < GITHUB_DEFAULT_MINUTES)) {
          offenders.push(
            `${file} ${job.jobId}: timeout-minutes ${JSON.stringify(job.keys.get("timeout-minutes") ?? null)}`,
          );
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "size each from the job's real duration with headroom, as the comment at the top of ci.yml says",
    );
  });

  it("bounds the Playwright apt steps that hung on their own", () => {
    // The job timeout would still hold the lock for its whole length; the step
    // timeout fails the hang early, well past a slow mirror's few minutes.
    const apt = workflowSteps(join(WORKFLOW_DIR, "ci.yml")).filter(
      (step) => step.name === "Install Playwright OS deps",
    );
    assert.deepEqual(
      apt.map((step) => step.jobId).sort(),
      ["landing-fold", "web-responsive-floor"],
    );
    for (const step of apt) {
      const match = /^\s+timeout-minutes:\s*(\S+)\s*$/m.exec(step.body);
      assert.ok(match, `${step.jobId}'s apt step sets timeout-minutes`);
      assert.ok(minutes(match[1]) <= 15, `${step.jobId}: ${match[1]}`);
    }
  });

  it("outlasts the migration snapshot wait in every job that can take it", () => {
    // `download-migration-snapshot` with `on-stale: wait` polls for up to
    // WAIT_SECONDS before it fails with a re-run hint. A job timeout shorter
    // than that kills a required check that would have passed.
    const action = readFileSync(
      join(ACTION_DIR, "download-migration-snapshot", "action.yml"),
      "utf8",
    );
    const wait = /^\s*WAIT_SECONDS=(\d+)\s*$/m.exec(action);
    assert.ok(wait, "the action still sets WAIT_SECONDS");
    const waitMinutes = Number(wait[1]) / 60;

    const waiting = [];
    for (const file of files) {
      const path = join(WORKFLOW_DIR, file);
      const timeouts = new Map(
        workflowJobs(path).map((job) => [
          job.jobId,
          minutes(job.keys.get("timeout-minutes")),
        ]),
      );
      for (const step of workflowSteps(path)) {
        if (!/download-migration-snapshot/.test(step.body)) continue;
        if (!/^\s+on-stale:.*\bwait\b/m.test(step.body)) continue;
        waiting.push(`${file} ${step.jobId}`);
        assert.ok(
          timeouts.get(step.jobId) >= waitMinutes + 10,
          `${file} ${step.jobId}: timeout ${timeouts.get(step.jobId)} vs a ${waitMinutes}-minute wait`,
        );
      }
    }
    assert.ok(waiting.length >= 2, `found ${waiting.join(", ")}`);
  });
});
