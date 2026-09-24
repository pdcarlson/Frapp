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
    anchored: { contents: &r "read]", issues: write }
    tagged: { a: !!str "x, y", b: c }
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
      - "if": \${{ inputs.dry_run_only }}
        run: echo
  spaced:
    if : \${{ failure() }}
    steps :
      - name : Spaced
        if : \${{ success() }}
        env :
          KEY : v
        run: echo
      - if : \${{ inputs.dry_run_only }}
        run: echo
  deploy :
    steps:
      - name: Behind a spaced header
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

  it("keeps a flow mapping's entries whole through nesting, apostrophes, parentheses and escapes", () => {
    const edges = workflowJobs(file).find((job) => job.jobId === "edges");
    const read = (key) => asObject(edges.keys.get(key));
    assert.deepEqual(read("nested"), { a: "[x, y]", b: "c" });
    // A quote only opens a quoted scalar where a scalar starts, so the
    // apostrophe is text and `issues` is still seen.
    assert.deepEqual(read("apostrophe"), { note: "don't", issues: "write" });
    assert.deepEqual(read("closer"), { x: "a)", y: "z" });
    // A node property before a quoted value must not hide what follows it:
    // `issues: write` here is a scope a permissions guard has to see.
    assert.deepEqual([...edges.keys.get("anchored").keys()], ["contents", "issues"]);
    assert.equal(read("anchored").issues, "write");
    assert.equal(read("tagged").b, "c");
    // The escaped quote doesn't end the scalar, so its comma isn't a split.
    // Values keep their escapes: the helper strips the quotes, not the escapes.
    assert.deepEqual(read("escaped"), { a: 'x\\", y', b: "z" });
    assert.deepEqual(read("doubled"), { a: "it''s, ok", b: "z" });
  });

  it("reads quoted structural keys: a job's if and steps, and a step's name, if and env", () => {
    const job = workflowJobs(file).find((j) => j.jobId === "quoted-structure");
    assert.equal(job.if, "${{ always() }}");
    const quoted = workflowSteps(file).filter((s) => s.jobId === "quoted-structure");
    assert.equal(quoted.length, 2, "a quoted steps: must not hide the job's steps");
    assert.equal(quoted[0].name, "Quoted");
    assert.equal(quoted[0].if, "${{ success() }}");
    // The override a guard looks for must be visible behind a quoted env:.
    assert.equal(quoted[0].env.get("GITHUB_SHA"), "override");
    // A step that LEADS with a quoted `- "if":` must not read as ungated.
    assert.equal(quoted[1].if, "${{ inputs.dry_run_only }}");
  });

  it("reads structural keys written with a space before the colon", () => {
    const job = workflowJobs(file).find((j) => j.jobId === "spaced");
    assert.equal(job.if, "${{ failure() }}");
    const spaced = workflowSteps(file).filter((s) => s.jobId === "spaced");
    assert.equal(spaced.length, 2, "`steps :` must not hide the job's steps");
    assert.equal(spaced[0].name, "Spaced");
    assert.equal(spaced[0].if, "${{ success() }}");
    assert.equal(spaced[0].env.get("KEY"), "v");
    assert.equal(spaced[1].if, "${{ inputs.dry_run_only }}");
    // A `  deploy :` job header is a job, not more of the job before it.
    const deploy = workflowSteps(file).filter((s) => s.jobId === "deploy");
    assert.deepEqual(
      deploy.map((s) => s.name),
      ["Behind a spaced header"],
    );
    assert.ok(workflowJobs(file).some((j) => j.jobId === "deploy"));
  });

  it("finds the jobs of a file whose jobs: key is quoted, spaced or carries a comment", () => {
    // Every job vanishing is how a guard that loops over all workflows would
    // silently drop a file while its floor stays met.
    for (const header of ['"jobs":', "jobs: # all of them", "jobs :"]) {
      const variant = join(dir, "variant.yml");
      writeFileSync(variant, WORKFLOW.replace(/^jobs:$/m, header));
      assert.ok(workflowJobs(variant).length > 0, `${header}: no jobs`);
      assert.ok(workflowSteps(variant).length > 0, `${header}: no steps`);
    }
  });

  it("reads step env keys quoted or bare, and a comment-only value as empty", () => {
    const report = workflowSteps(file).find((s) => s.name === "Report");
    assert.equal(report.jobId, "build");
    assert.equal(report.env.get("PLAIN"), "value");
    assert.equal(report.env.get("QUOTED"), "a, b");
    assert.equal(report.env.get("EMPTY"), "");
  });
});
