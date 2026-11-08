// Pins the parts of .github/workflows/pr-base-sync.yml that the auto-merge update
// slot (#3599) depends on and that no other test reads. The workflow runs only
// on `main` (push, schedule, and the default branch's copy for workflow_run), so
// a PR that breaks any of these passes its own CI and fails silently after merge.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { workflowJobs } from "./helpers/workflow-yaml.mjs";

const WORKFLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "pr-base-sync.yml",
);
const text = readFileSync(WORKFLOW, "utf8");
const uncommented = text
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");
const job = workflowJobs(WORKFLOW).find((j) => j.jobId === "pr-base-sync");

describe("pr-base-sync.yml", () => {
  it("has the sweep job", () => {
    assert.ok(job, "no pr-base-sync job");
  });

  it("re-reads the slot on the completion of every workflow that emits a required check", () => {
    // ci.yml and migration-drift-gate.yml together emit ALL_REQUIRED_CHECKS
    // (scripts/ci/lib/required-checks.mjs). A renamed or mistyped name here
    // means workflow_run never fires, and a red holder stalls the queue.
    assert.match(uncommented, /workflows: \[CI, "Migration drift gate"\]\n {4}types: \[completed\]/);
    const ci = readFileSync(join(dirname(WORKFLOW), "ci.yml"), "utf8");
    const drift = readFileSync(join(dirname(WORKFLOW), "migration-drift-gate.yml"), "utf8");
    assert.match(ci, /^name: CI$/m);
    assert.match(drift, /^name: Migration drift gate$/m);
  });

  it("keeps the scheduled backstop that ends a grace no event follows", () => {
    assert.match(uncommented, /^ {2}schedule:\n {4}- cron: "\*\/15 \* \* \* \*"/m);
  });

  it("refuses a fork's CI completion, and main's own", () => {
    // workflow_run fires in the BASE repo's context, and this job mints the App
    // token. Without the guard a fork could add a workflow named `CI` and fire
    // the job at will (docs/ci-cd/pr-babysitting.md, the security review).
    // Both conditions, joined by && (an || would let either alone through).
    assert.match(
      job.if.replace(/\s+/g, " "),
      /\(github\.event\.workflow_run\.event == 'pull_request' && github\.event\.workflow_run\.head_repository\.full_name == github\.repository\)/,
    );
    // Every other event the job accepts is named outright.
    const events = [...job.if.matchAll(/github\.event_name == '([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(events.sort(), ["push", "schedule"]);
  });

  it("can read check runs", () => {
    // Without it every checks read fails: up-to-date auto-merge PRs read as in
    // flight and behind ones are tried in number order, so the slot degrades.
    assert.match(uncommented, /^ {2}checks: read$/m);
  });
});
