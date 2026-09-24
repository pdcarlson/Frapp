import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workflowJobs, workflowKeys, workflowSteps } from "./helpers/workflow-yaml.mjs";

// The key readers `helpers/workflow-yaml.mjs` added for #2431's workflow test.
// Each case is a shape that is valid YAML, means the same thing to Actions as
// its plain form, and once read differently: a guard that reads it wrong
// either fails a correct workflow (and gets deleted) or passes one that grants
// more than it asserts.

const WORKFLOW = `name: Example
on:
  push:
    branches: [ main ]
permissions: # workflow-wide
  contents: read
  "issues": write
jobs:
  "build": # the job
    needs: [lint, test]
    outputs: # the verdict
      outcome: \${{ steps.verify.outputs.outcome }}
      'quoted-out': x
    permissions: { contents: read, "id-token": write }
    environment:
      name: staging  # credentials
      deployment:
    if: \${{ !cancelled() }}
    steps:
      - name: Report
        id: report
        env:
          PLAIN: value # trailing comment
          "QUOTED": "a, b"
          EMPTY: # nothing
        run: echo
  flow:
    outputs: { joined: "\${{ format('{0}, {1}', a, b) }}", other: 'x, y' }
    steps:
      - run: echo
  edges:
    nested: { a: [x, y], b: c }
    apostrophe: { note: don't, issues: write }
    closer: { x: a), y: z }
    escaped: { a: "x\\", y", b: z }
    doubled: { a: 'it''s, ok', b: z }
    steps:
      - run: echo
  "quoted-structure":
    "if": \${{ always() }}
    "steps":
      - "name": Quoted
        "if": \${{ success() }}
        "env":
          GITHUB_SHA: override
        run: echo
`;

describe("helpers/workflow-yaml.mjs key readers", () => {
  let dir;
  let file;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "workflow-yaml-helper-"));
    file = join(dir, "example.yml");
    writeFileSync(file, WORKFLOW);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const asObject = (value) => (value instanceof Map ? Object.fromEntries(value) : value);

  it("reads a workflow-level block with a commented header and a quoted key whole", () => {
    const top = workflowKeys(file);
    assert.equal(top.get("name"), "Example");
    assert.deepEqual([...top.get("on").keys()], ["push"]);
    // The quoted write scope must be seen: a guard on this block is the point.
    assert.deepEqual(asObject(top.get("permissions")), { contents: "read", issues: "write" });
  });

  it("reads a quoted, commented job header and the job's own keys", () => {
    const [build] = workflowJobs(file);
    assert.equal(build.jobId, "build");
    assert.equal(build.if, "${{ !cancelled() }}");
    assert.equal(build.keys.get("needs"), "[lint, test]");
    assert.deepEqual(asObject(build.keys.get("outputs")), {
      outcome: "${{ steps.verify.outputs.outcome }}",
      "quoted-out": "x",
    });
    assert.deepEqual(asObject(build.keys.get("permissions")), {
      contents: "read",
      "id-token": "write",
    });
    assert.deepEqual(asObject(build.keys.get("environment")), { name: "staging", deployment: "" });
  });

  it("splits a flow mapping only on its top-level commas", () => {
    const flow = workflowJobs(file).find((job) => job.jobId === "flow");
    assert.deepEqual(asObject(flow.keys.get("outputs")), {
      joined: "${{ format('{0}, {1}', a, b) }}",
      other: "x, y",
    });
  });

  it("keeps a flow mapping's entries whole through nesting, apostrophes, stray closers and escapes", () => {
    const edges = workflowJobs(file).find((job) => job.jobId === "edges");
    const read = (key) => asObject(edges.keys.get(key));
    assert.deepEqual(read("nested"), { a: "[x, y]", b: "c" });
    // A quote only opens a quoted scalar where a scalar starts, so the
    // apostrophe is text and `issues` is still seen.
    assert.deepEqual(read("apostrophe"), { note: "don't", issues: "write" });
    assert.deepEqual(read("closer"), { x: "a)", y: "z" });
    assert.equal(read("escaped").b, "z");
    assert.equal(read("doubled").b, "z");
  });

  it("reads quoted structural keys: a job's if and steps, and a step's name, if and env", () => {
    const job = workflowJobs(file).find((j) => j.jobId === "quoted-structure");
    assert.equal(job.if, "${{ always() }}");
    const quoted = workflowSteps(file).filter((s) => s.jobId === "quoted-structure");
    assert.equal(quoted.length, 1, "a quoted steps: must not hide the job's steps");
    assert.equal(quoted[0].name, "Quoted");
    assert.equal(quoted[0].if, "${{ success() }}");
    // The override a guard looks for must be visible behind a quoted env:.
    assert.equal(quoted[0].env.get("GITHUB_SHA"), "override");
  });

  it("reads step env keys quoted or bare, and a comment-only value as empty", () => {
    const report = workflowSteps(file).find((s) => s.name === "Report");
    assert.equal(report.jobId, "build");
    assert.equal(report.env.get("PLAIN"), "value");
    assert.equal(report.env.get("QUOTED"), "a, b");
    assert.equal(report.env.get("EMPTY"), "");
  });
});
