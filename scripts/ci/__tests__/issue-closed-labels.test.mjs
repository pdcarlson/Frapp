import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_DIR, stepRunScript, workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

// .github/workflows/issue-closed-labels.yml: takes `in-review` and
// `in-progress` off an issue when it closes, so no session has to do it by
// hand after Paul merges the PR that closed it. The step is inline shell, so
// this runs that exact script under bash with a stub `gh` first on PATH and a
// fake event payload, and reads back which DELETEs it made.

const WORKFLOW = join(WORKFLOW_DIR, "issue-closed-labels.yml");
const text = readFileSync(WORKFLOW, "utf8");
const uncommented = text
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

const [step] = workflowSteps(WORKFLOW);

/**
 * Runs the step with the issue carrying `labels`. `ghExit` / `ghOut` set what
 * the stub `gh` does for every call. Returns the exit status, output, and the
 * `gh` argument lists in call order.
 */
function run(labels, { ghExit = 0, ghOut = "", issue = "42" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "issue-closed-labels-"));
  try {
    const event = join(dir, "event.json");
    writeFileSync(event, JSON.stringify({ issue: { number: 42, labels: labels.map((name) => ({ name })) } }));
    const log = join(dir, "gh.log");
    const gh = join(dir, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '%s\\n' ${JSON.stringify(ghOut)}\nexit ${ghExit}\n`,
    );
    chmodSync(gh, 0o755);
    const result = spawnSync("bash", ["-c", stepRunScript(step)], {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_EVENT_PATH: event,
        GH_TOKEN: "test-token",
        ISSUE: issue,
        REPO: "pdcarlson/Frapp",
      },
    });
    let calls = [];
    try {
      calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    } catch {
      // No log file: gh was never called.
    }
    return { status: result.status, out: result.stdout + result.stderr, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const del = (label) => `api --method DELETE repos/pdcarlson/Frapp/issues/42/labels/${label}`;

describe("issue-closed-labels.yml", () => {
  it("fires on an issue closing, and on nothing else", () => {
    assert.match(uncommented, /^on:\n {2}issues:\n {4}types: \[closed\]\n/m);
    assert.doesNotMatch(uncommented, /^ {2}(pull_request|pull_request_target|push|workflow_run):/m);
  });

  it("holds only the issues permission it needs", () => {
    assert.match(uncommented, /^permissions:\n {2}issues: write\n\n/m);
  });

  it("skips the runner unless the issue carries either label, not only both", () => {
    const [job] = workflowJobs(WORKFLOW);
    assert.equal(
      job.if.replace(/\s+/g, " ").trim(),
      "contains(github.event.issue.labels.*.name, 'in-review') || contains(github.event.issue.labels.*.name, 'in-progress')",
    );
  });

  it("hands the script this issue's number, this repo and the job's own token", () => {
    assert.equal(step.env.get("ISSUE"), "${{ github.event.issue.number }}");
    assert.equal(step.env.get("REPO"), "${{ github.repository }}");
    assert.equal(step.env.get("GH_TOKEN"), "${{ secrets.GITHUB_TOKEN }}");
  });

  it("removes in-review from a closed issue and leaves its other labels alone", () => {
    const { status, calls } = run(["in-review", "P2", "area:api"]);
    assert.equal(status, 0);
    assert.deepEqual(calls, [del("in-review")]);
  });

  it("removes both open-state labels when both are present", () => {
    const { status, calls } = run(["in-progress", "in-review"]);
    assert.equal(status, 0);
    assert.deepEqual(calls, [del("in-review"), del("in-progress")]);
  });

  it("makes no call when neither label is present", () => {
    const { status, calls } = run(["P1", "triage"]);
    assert.equal(status, 0);
    assert.deepEqual(calls, []);
  });

  it("matches label names exactly, not by prefix", () => {
    const { calls } = run(["in-review-later", "not-in-progress"]);
    assert.deepEqual(calls, []);
  });

  it("treats a label already removed (404) as done", () => {
    const { status, out } = run(["in-review"], { ghExit: 1, ghOut: "gh: Label does not exist (HTTP 404)" });
    assert.equal(status, 0);
    assert.match(out, /already gone/);
  });

  it("fails on any other API error, so a broken token is visible", () => {
    const { status, out } = run(["in-review"], { ghExit: 1, ghOut: "gh: Resource not accessible by integration (HTTP 403)" });
    assert.equal(status, 1);
    assert.match(out, /HTTP 403/);
  });

  it("fails rather than calling the API when the event carries no issue number", () => {
    const { status, calls } = run(["in-review"], { issue: "" });
    assert.equal(status, 1);
    assert.deepEqual(calls, []);
  });
});
