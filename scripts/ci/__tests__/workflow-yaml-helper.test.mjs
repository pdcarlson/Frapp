import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workflowJobs, workflowKeys, workflowSteps } from "./helpers/workflow-yaml.mjs";

// The key readers `helpers/workflow-yaml.mjs` added for #2431's workflow test.
// The fixture's shapes are valid YAML that mean the same thing to Actions as
// their plain form, and were once read differently: a guard that reads one
// wrong either fails a correct workflow (and gets deleted) or passes one that
// grants more than it asserts. A flow mapping is the exception by design: the
// reader refuses it (see "refuses any flow mapping …") rather than guess at it.

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
    permissions:
      contents: read
      "id-token": write
    name: '{ Nightly }'
    concurrency: "deploy #1"
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
    // Quoted, these are strings, not a flow mapping and not a comment.
    assert.equal(build.keys.get("name"), "{ Nightly }");
    assert.equal(build.keys.get("concurrency"), "deploy #1");
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

  it("refuses any flow mapping where it reads keys, on one line or several", () => {
    // Hand-splitting one misread a new valid shape every round (#2431), and a
    // misread can hide a scope. Refusing can't.
    for (const flow of [
      "{ contents: read, issues: write }",
      '{ contents: read, note: "x #y", issues: write }',
      "{ contents: &r read, issues: write }",
      "{ contents: read,\n      issues: write }",
      "{\n      contents: read\n    }",
      // A node property in front is still a flow mapping.
      "&p { contents: read, issues: write }",
      "!!map { contents: write }",
    ]) {
      const variant = join(dir, "flow.yml");
      writeFileSync(
        variant,
        `name: X\npermissions: ${flow}\njobs:\n  j:\n    permissions: ${flow}\n    steps:\n      - run: echo\n`,
      );
      assert.throws(() => workflowKeys(variant), /is a flow mapping/, `workflow level: ${flow}`);
      assert.throws(() => workflowJobs(variant)[0].keys, /is a flow mapping/, `job level: ${flow}`);
      // A caller reading only the job id and condition is never refused.
      assert.equal(workflowJobs(variant)[0].jobId, "j");
    }
  });

  it("refuses a flow-form env at workflow, job or step level, not read it as empty", () => {
    // An empty env would pass an absence guard on the override it hides.
    const shapes = {
      workflow: "name: X\nenv: { GITHUB_SHA: o }\njobs:\n  j:\n    steps:\n      - run: echo\n",
      job: "name: X\njobs:\n  j:\n    env: { GITHUB_SHA: o }\n    steps:\n      - run: echo\n",
      step: "name: X\njobs:\n  j:\n    steps:\n      - name: S\n        env: &e { GITHUB_SHA: o }\n        run: echo\n",
    };
    for (const [level, text] of Object.entries(shapes)) {
      const variant = join(dir, `flow-env-${level}.yml`);
      writeFileSync(variant, text);
      assert.throws(() => workflowSteps(variant), /`env:` is a flow mapping/, level);
    }
  });

  it("reads an env that is the step's first key, and refuses it in flow form", () => {
    const block = join(dir, "first-key-env.yml");
    writeFileSync(
      block,
      "name: X\njobs:\n  j:\n    steps:\n      - env:\n          GITHUB_SHA: o\n        run: echo\n",
    );
    assert.equal(workflowSteps(block)[0].env.get("GITHUB_SHA"), "o");
    const flow = join(dir, "first-key-flow-env.yml");
    writeFileSync(flow, "name: X\njobs:\n  j:\n    steps:\n      - env: { GITHUB_SHA: o }\n        run: echo\n");
    assert.throws(() => workflowSteps(flow), /`env:` is a flow mapping/);
    // The env's children sit deeper than the step's keys wherever the dash
    // is, so a sequence at indent 4 reads a first-key env the same.
    const shallow = join(dir, "first-key-env-shallow.yml");
    writeFileSync(shallow, "name: X\njobs:\n  j:\n    steps:\n    - env:\n        GITHUB_SHA: o\n      run: echo\n");
    assert.equal(workflowSteps(shallow)[0].env.get("GITHUB_SHA"), "o");
  });

  it("ends the last step where the steps sequence ends, not at the end of the job", () => {
    // A service container's env after `steps:` belongs to the service: it is
    // neither the last step's env nor a step env to refuse.
    const services = join(dir, "services.yml");
    const text = (env) =>
      "name: X\njobs:\n  j:\n    steps:\n      - name: Test\n        run: npm test\n" +
      `    services:\n      postgres:\n        image: postgres:16\n        env: ${env}\n`;
    writeFileSync(services, text("{ POSTGRES_PASSWORD: postgres }"));
    assert.deepEqual([...workflowSteps(services)[0].env], []);
    writeFileSync(services, text("\n          POSTGRES_PASSWORD: postgres"));
    assert.deepEqual([...workflowSteps(services)[0].env], []);
    // A sequence at the job-key indent (`    steps:` / `    - name:`) ends at
    // the next job key on that same indent.
    writeFileSync(
      services,
      "name: X\njobs:\n  j:\n    steps:\n    - name: Test\n      run: npm test\n" +
        "    services:\n      postgres:\n        env:\n          GITHUB_SHA: x\n",
    );
    const [only] = workflowSteps(services);
    assert.deepEqual([...only.env], []);
    assert.doesNotMatch(only.body, /services:/);
  });

  it("reads every step entry form, so none ends the sequence or hides the steps after it", () => {
    // A bare `-` with its keys below, extra spaces after the dash, and a dash
    // with trailing whitespace are all step entries. Misread as a job key, one
    // would drop every later step, and with it C's GITHUB_SHA override.
    const forms = join(dir, "entry-forms.yml");
    writeFileSync(
      forms,
      "name: X\njobs:\n  j:\n    steps:\n" +
        "      - name: A\n        run: a\n" +
        "      -\n        name: B\n        run: b\n" +
        "      -   name: B2\n          if: always()\n          run: b2\n" +
        "      - \n        name: B3\n        run: b3\n" +
        "      - name: C\n        env:\n          GITHUB_SHA: o\n        run: c\n",
    );
    const steps = workflowSteps(forms);
    assert.deepEqual(
      steps.map((s) => s.name),
      ["A", "B", "B2", "B3", "C"],
    );
    assert.equal(steps.at(-1).env.get("GITHUB_SHA"), "o");
    // B2's keys sit where its first key does, two columns past a normal step's.
    assert.equal(steps[2].if, "always()");
  });

  it("reads each step's keys at that step's own key indent, whatever the layout", () => {
    // A step's keys line up with the first key after its dash (or, after a
    // bare `-`, with the line below). Reading them at a fixed column 8 misses
    // them in the 4-space style and after extra spaces, which is how an
    // override hides from an absence guard and a gated step reads as ungated.
    const layouts = join(dir, "layouts.yml");
    writeFileSync(
      layouts,
      "name: X\njobs:\n" +
        // 4-space style: dash at 4, keys at 6.
        "  four:\n    steps:\n    - name: F\n      if: always()\n      env:\n        GITHUB_SHA: o\n" +
        "      run: |\n        if : ; then echo; fi\n" +
        // Extra spaces: dash at 6, keys at 10, a first-key env then a sibling mapping.
        "  wide:\n    steps:\n      -   env:\n            A: '1'\n          with:\n            ref: x\n" +
        "      -   if: success()\n          name: W\n" +
        // A bare `-` with no name: named by its first key.
        "  bare:\n    steps:\n      -\n        run: d\n",
    );
    const steps = workflowSteps(layouts);
    const four = steps.find((s) => s.jobId === "four");
    assert.equal(four.name, "F");
    assert.equal(four.if, "always()", "a run-body `if :` must not be read as the condition");
    assert.equal(four.env.get("GITHUB_SHA"), "o");
    const wide = steps.filter((s) => s.jobId === "wide");
    assert.deepEqual(Object.fromEntries(wide[0].stepEnv), { A: "1" }, "`with:` is a sibling, not env");
    assert.equal(wide[1].if, "success()");
    assert.equal(wide[1].name, "W");
    assert.equal(steps.find((s) => s.jobId === "bare").name, "<unnamed: run>");
  });

  it("reads a comment after the dash, or after an if:'s indicator, as a comment", () => {
    // `- # note` is a bare `-`: its keys start on the line below. And
    // `if: >- # note` is a block-scalar header; the condition is below it.
    const comments = join(dir, "comments.yml");
    writeFileSync(
      comments,
      "name: X\njobs:\n  j:\n    if: >- # push only\n      github.event_name == 'push'\n    steps:\n" +
        "      -   # note\n        name: A\n        if: always()\n        env:\n          GITHUB_SHA: o\n" +
        "      - name: B\n        if: >- # dry runs only\n          inputs.dry_run_only\n" +
        "      - name: C\n        if: success() # inline note\n",
    );
    const [a, b, c] = workflowSteps(comments);
    assert.equal(a.name, "A");
    assert.equal(a.if, "always()");
    assert.equal(a.env.get("GITHUB_SHA"), "o");
    assert.equal(b.if, "inputs.dry_run_only");
    assert.equal(c.if, "success()");
    assert.equal(workflowJobs(comments)[0].if, "github.event_name == 'push'");
  });

  it("names an unnamed step by its first key, not by a comment after its dash", () => {
    const unnamed = join(dir, "unnamed.yml");
    writeFileSync(unnamed, "name: X\njobs:\n  j:\n    steps:\n      - # note\n        run: echo hi\n");
    assert.deepEqual(
      workflowSteps(unnamed).map((s) => s.name),
      ["<unnamed: run>"],
    );
  });

  it("keeps a # inside a quoted value: only an unquoted # starts a comment", () => {
    // `if:` is often quoted (a leading `!` is a YAML tag), and a ` #` inside
    // the quotes is part of the condition. Cutting there drops the clause
    // after it, and a `doesNotMatch(/dry_run_only/)` guard passes on a step
    // that is gated. A quote in the trailing comment must not extend the value
    // either, or a `match(/!inputs\.dry_run_only/)` guard passes on an ungated one.
    const quoted = join(dir, "quoted.yml");
    writeFileSync(
      quoted,
      [
        "name: X",
        "jobs:",
        "  j:",
        `    if: "!contains(github.event.head_commit.message, 'skip #release') && !inputs.dry_run_only" # note`,
        "    steps:",
        `      - if: "github.event.head_commit.message != 'wip #' && inputs.dry_run_only"`,
        "        run: echo",
        `      - name: 'B #2' # say "hi"`,
        `        if: 'x != ''a #b'' && inputs.dry_run_only' # note`,
        "        env:",
        `          TAG: "v1 #beta" # it's "quoted"`,
        String.raw`          SAY: "say \"hi #1\"" # c`,
        String.raw`      - if: "github.actor == \"bot\" # x || inputs.dry_run_only"`,
        "        run: echo",
        `      - if: 'always()' # was '!inputs.dry_run_only'`,
        "        run: echo",
        "  k:",
        `    if: 'always()' # was '!inputs.dry_run_only'`,
        "    steps:",
        "      - run: echo",
        "",
      ].join("\n"),
    );
    const [a, b, c, d] = workflowSteps(quoted);
    assert.equal(a.if, `"github.event.head_commit.message != 'wip #' && inputs.dry_run_only"`);
    assert.equal(b.name, "B #2");
    assert.equal(b.if, `'x != ''a #b'' && inputs.dry_run_only'`);
    assert.equal(b.env.get("TAG"), "v1 #beta");
    assert.equal(b.env.get("SAY"), 'say "hi #1"');
    assert.equal(c.if, String.raw`"github.actor == \"bot\" # x || inputs.dry_run_only"`);
    assert.equal(d.if, "'always()'");
    const [j, k] = workflowJobs(quoted);
    assert.equal(j.if, `"!contains(github.event.head_commit.message, 'skip #release') && !inputs.dry_run_only"`);
    assert.equal(k.if, "'always()'");
  });

  it("folds a plain if: continued on deeper lines into one condition", () => {
    // YAML folds the lines of a plain scalar. Reading only the first dropped
    // every clause after the break. A continuation line is plain text: its
    // quotes quote nothing, and ` #` still starts a comment.
    const folded = join(dir, "folded.yml");
    writeFileSync(
      folded,
      "name: X\njobs:\n  j:\n    if: inputs.scope != 'x'\n      && !inputs.dry_run_only # gated\n    steps:\n" +
        "      - name: A\n        if: github.actor == 'bot' &&\n          'c' == inputs.dry_run_only # note\n        run: echo\n" +
        "      - if: always() &&\n          inputs.dry_run_only\n        name: B\n" +
        "      - name: C\n        if: always() &&\n         inputs.dry_run_only\n",
    );
    const [a, b, c] = workflowSteps(folded);
    assert.equal(a.if, "github.actor == 'bot' && 'c' == inputs.dry_run_only");
    assert.equal(b.if, "always() && inputs.dry_run_only");
    assert.equal(b.name, "B");
    // One column deeper than the key is enough to continue it.
    assert.equal(c.if, "always() && inputs.dry_run_only");
    assert.equal(workflowJobs(folded)[0].if, "inputs.scope != 'x' && !inputs.dry_run_only");
  });

  it("reads the condition below an if: that holds only a comment", () => {
    const below = join(dir, "below.yml");
    writeFileSync(
      below,
      "name: X\njobs:\n  j:\n    if: # gated\n      inputs.dry_run_only\n    steps:\n" +
        "      - name: A\n        if: # gated\n          inputs.dry_run_only\n        run: echo\n",
    );
    assert.equal(workflowSteps(below)[0].if, "inputs.dry_run_only");
    assert.equal(workflowJobs(below)[0].if, "inputs.dry_run_only");

    // The line below may open a quoted value, whose ` #` is not a comment.
    const quotedBelow = join(dir, "quoted-below.yml");
    const quotedCondition = `"contains(github.event.head_commit.message, ' #skip') && inputs.dry_run_only"`;
    writeFileSync(
      quotedBelow,
      `name: X\njobs:\n  j:\n    if: # gated\n      ${quotedCondition}\n    steps:\n` +
        `      - name: A\n        if:\n          ${quotedCondition}\n        run: echo\n`,
    );
    assert.equal(workflowSteps(quotedBelow)[0].if, quotedCondition);
    assert.equal(workflowJobs(quotedBelow)[0].if, quotedCondition);

    // A trailing comment after that quoted value is still a comment; and an
    // `if:` with nothing below it is null, not its next sibling.
    const edges = join(dir, "if-edges.yml");
    writeFileSync(
      edges,
      `name: X\njobs:\n  j:\n    if:\n    runs-on: ubuntu-latest\n    steps:\n` +
        `      - name: A\n        if:\n          ${quotedCondition} # note\n        run: echo\n` +
        `      - name: B\n        if:\n        run: echo\n`,
    );
    const [a, b] = workflowSteps(edges);
    assert.equal(a.if, quotedCondition);
    assert.equal(b.if, null);
    assert.equal(workflowJobs(edges)[0].if, null);

    // A block indicator on the next line opens a block, whose ` #` is content:
    // read as plain text, it cut the condition at `' #skip'`.
    const blockBelow = join(dir, "block-below.yml");
    const condition = "contains(github.event.head_commit.message, ' #skip') && !inputs.dry_run_only";
    writeFileSync(
      blockBelow,
      `name: X\njobs:\n  j:\n    if:\n      >-\n        ${condition}\n    steps:\n` +
        `      - name: A\n        if: # gated\n          >-\n            ${condition}\n        run: echo\n`,
    );
    assert.equal(workflowSteps(blockBelow)[0].if, condition);
    assert.equal(workflowJobs(blockBelow)[0].if, condition);
  });

  it("decodes a quoted value as Actions sees it, and leaves a plain one as written", () => {
    const values = join(dir, "values.yml");
    writeFileSync(
      values,
      [
        "name: X",
        "jobs:",
        "  j:",
        "    steps:",
        "      - run: echo",
        "        env:",
        '          PHASE: "build"#pre-apply',
        '          EMPTY: ""#unset',
        "          PLAIN: say 'hi'",
        "          SINGLE: 'don''t # x'",
        String.raw`          UNICODE: "caf\u00e9 \U0001F600"`,
        String.raw`          YAML_ONLY: "\x41\ \_\e\N"`,
        '          RAW_TAB: "a\tb"',
        String.raw`          ESCAPED_TAB: "a\	b"`,
        String.raw`          SLASHES: "a\\b\/c"`,
        String.raw`          NOT_UNICODE: "a\\u0041"`,
        "          PAIRS: 'a ''b'' c'",
        String.raw`          CONTROL: "\0\a\b\t\n\v\f\r\L\P"`,
        "",
      ].join("\n"),
    );
    const { env } = workflowSteps(values)[0];
    assert.equal(env.get("PHASE"), "build");
    assert.equal(env.get("EMPTY"), "");
    assert.equal(env.get("PLAIN"), "say 'hi'");
    assert.equal(env.get("SINGLE"), "don't # x");
    assert.equal(env.get("UNICODE"), "café 😀");
    assert.equal(env.get("YAML_ONLY"), "A \u00a0\u001b\u0085");
    assert.equal(env.get("RAW_TAB"), "a\tb");
    assert.equal(env.get("ESCAPED_TAB"), "a\tb");
    assert.equal(env.get("SLASHES"), "a\\b/c");
    assert.equal(env.get("NOT_UNICODE"), String.raw`a\u0041`);
    assert.equal(env.get("PAIRS"), "a 'b' c");
    assert.equal(env.get("CONTROL"), "\0\x07\b\t\n\v\f\r\u2028\u2029");
  });

  it("reads a block-scalar value as its content, not its indicator", () => {
    // Every composite action's `description: >` read as ">", and a job's
    // `if: |` in its keys as "|": a guard over either passed whatever it said.
    const blocks = join(dir, "blocks.yml");
    writeFileSync(
      blocks,
      [
        "name: X",
        "description: >",
        "  one",
        "  two",
        "jobs:",
        "  j:",
        "    if: |",
        "      a &&",
        "      b",
        "    steps:",
        "      - name: >-",
        "          Deploy the",
        "          commit",
        "        env:",
        "          FOLDED: >- # note",
        "            x",
        "            y",
        "          LITERAL: |",
        "            l1",
        "            l2",
        "          AFTER: z",
        "",
      ].join("\n"),
    );
    assert.equal(workflowKeys(blocks).get("description"), "one two");
    assert.equal(workflowJobs(blocks)[0].keys.get("if"), "a &&\nb");
    const [step] = workflowSteps(blocks);
    assert.equal(step.name, "Deploy the commit");
    assert.deepEqual(Object.fromEntries(step.stepEnv), { FOLDED: "x y", LITERAL: "l1\nl2", AFTER: "z" });
  });

  it("refuses a quoted value that spans lines, or an escape YAML does not have", () => {
    // Read line by line, a quoted `if:` split across lines would come back as
    // its first line, and the clause after the break would be invisible.
    const spanning = (at) => {
      const file = join(dir, `spanning-${at}.yml`);
      const job = at === "job" ? `    if: "inputs.scope != 'migrations-only'\n      && !inputs.dry_run_only"\n` : "";
      const step = at === "step" ? `        if: "inputs.scope != 'migrations-only'\n          && !inputs.dry_run_only"\n` : "";
      writeFileSync(file, `name: X\njobs:\n  j:\n${job}    steps:\n      - name: A\n${step}        run: echo\n`);
      return file;
    };
    assert.throws(() => workflowSteps(spanning("step")), /does not close on its line/);
    assert.throws(() => workflowJobs(spanning("job")), /does not close on its line/);
    for (const opening of ["'inputs.scope != ''x''", `'github.actor != "bot"`]) {
      const single = join(dir, "spanning-single.yml");
      writeFileSync(
        single,
        `name: X\njobs:\n  j:\n    steps:\n      - name: A\n        if: ${opening}\n          && !inputs.dry_run_only'\n        run: echo\n`,
      );
      assert.throws(() => workflowSteps(single), /does not close on its line/, opening);
    }

    const escaped = join(dir, "escaped.yml");
    writeFileSync(escaped, "name: X\njobs:\n  j:\n    steps:\n      - run: echo\n        env:\n          A: \"\\q\"\n");
    assert.throws(() => workflowSteps(escaped), /is not a YAML escape/);
  });

  it("reads a file with a byte-order mark exactly as without one", () => {
    const bom = join(dir, "bom.yml");
    writeFileSync(bom, "\uFEFFenv:\n  A: b\nname: X\njobs:\n  j:\n    steps:\n      - run: echo\n");
    assert.deepEqual([...workflowKeys(bom).keys()], ["env", "name", "jobs"]);
    assert.equal(workflowSteps(bom)[0].env.get("A"), "b");
  });

  it("reads a CRLF file exactly as its LF form", () => {
    // A Windows checkout leaves `\r` on every line. Unhandled, every env and
    // key map read as empty, so an absence guard passed on any content.
    const lf = join(dir, "lf.yml");
    const crlf = join(dir, "crlf.yml");
    writeFileSync(lf, WORKFLOW);
    writeFileSync(crlf, WORKFLOW.replaceAll("\n", "\r\n"));
    const plain = (value) => (value instanceof Map ? [...value].map(([k, v]) => [k, plain(v)]) : value);
    const read = (file) => ({
      steps: workflowSteps(file).map((step) => ({ ...step, env: plain(step.env), stepEnv: plain(step.stepEnv) })),
      jobs: workflowJobs(file).map((job) => ({ jobId: job.jobId, if: job.if, keys: plain(job.keys) })),
      keys: plain(workflowKeys(file)),
    });
    const expected = read(lf);
    assert.ok(expected.steps.some((step) => step.env.length > 0));
    assert.deepEqual(read(crlf), { ...expected, steps: expected.steps.map((step) => ({ ...step, workflowFile: "crlf.yml" })) });
  });

  it("ends the last job where jobs: ends, not at a top-level block written after it", () => {
    // Each of a workflow's top-level keys ends `jobs:`, whichever comes first.
    const topLevel = ["name", "run-name", "on", "permissions", "env", "defaults", "concurrency"];
    for (const key of topLevel) {
      const after = join(dir, `after-${key}.yml`);
      writeFileSync(
        after,
        "jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n" +
          `${key}:\n  workflow_dispatch:\n    inputs:\n      dry_run_only:\n        type: boolean\n  push:\n    branches: [main]\n`,
      );
      assert.deepEqual([...workflowJobs(after)[0].keys.keys()], ["runs-on", "steps"], key);
      assert.deepEqual([...workflowKeys(after).keys()], ["jobs", key], key);
    }

    // Worse when the last job has no steps of its own: the trailing block's
    // indent-4 `steps:`, `env:` and `if:` became a phantom step and job gate.
    const phantom = join(dir, "phantom.yml");
    writeFileSync(
      phantom,
      "name: X\njobs:\n  a:\n    uses: ./.github/workflows/b.yml\n" +
        "on:\n  push:\n    if: phantom\n    env:\n      Z: phantom\n    steps:\n      - name: phantom\n",
    );
    assert.deepEqual(workflowSteps(phantom), []);
    const [job] = workflowJobs(phantom);
    assert.equal(job.if, null);
    assert.deepEqual([...job.keys.keys()], ["uses"]);

    // Written quoted or spaced, a top-level key still ends `jobs:`, and so
    // does a document marker.
    for (const [written, key] of [['"on"', "on"], ["on ", "on"], ["'env'", "env"]]) {
      const spelled = join(dir, "after-spelled.yml");
      writeFileSync(
        spelled,
        `jobs:\n  a:\n    steps:\n      - run: echo\n${written}:\n  push:\n    branches: [main]\n`,
      );
      assert.deepEqual(workflowJobs(spelled).map((job) => job.jobId), ["a"], written);
      assert.deepEqual([...workflowKeys(spelled).keys()], ["jobs", key], written);
    }
    const marker = join(dir, "after-marker.yml");
    writeFileSync(marker, "jobs:\n  a:\n    steps:\n      - run: echo\n---\n  push:\n");
    assert.deepEqual(workflowJobs(marker).map((job) => job.jobId), ["a"]);

    // An explicit top-level key (`? on`) ends `jobs:` too, or its children
    // at indent 2 read as phantom jobs.
    const explicit = join(dir, "explicit-key.yml");
    writeFileSync(explicit, "name: X\njobs:\n  a:\n    steps:\n      - run: echo\n? on\n:\n  push:\n    branches: [main]\n");
    assert.deepEqual(
      workflowJobs(explicit).map((job) => job.jobId),
      ["a"],
    );
  });

  it("refuses a value continued at column 0 inside jobs:, however it looks", () => {
    // Lenient parsers accept these. Ending `jobs:` at the continuation hid the
    // job's gate and steps; the line can look like a key (`https:`), so reading
    // on can't tell either.
    for (const [label, value] of [
      ["flow sequence", "needs: [a,\nb]"],
      ["key-like flow continuation", "with:\n      args: [--url,\nhttps://example.com]"],
      ["flow mapping pair", "with: {ref: main,\nfetch-depth: 0}"],
      ["quoted continuation", 'run: "echo a\nb: c"'],
    ]) {
      const file = join(dir, "column-0.yml");
      writeFileSync(
        file,
        `name: X\njobs:\n  a:\n    ${value}\n    if: always()\n    steps:\n      - name: B\n        if: inputs.dry_run_only\n`,
      );
      assert.throws(() => workflowSteps(file), /column-0 line inside `jobs:`/, label);
      assert.throws(() => workflowJobs(file), /column-0 line inside `jobs:`/, label);
    }
  });

  it("reads an empty flow mapping as an empty mapping: {} can hide nothing", () => {
    const empty = join(dir, "empty.yml");
    writeFileSync(
      empty,
      "name: X\npermissions: {}\nenv: {}\njobs:\n  j:\n    permissions: { }\n    steps:\n      - env: {}\n        run: echo\n",
    );
    assert.deepEqual([...workflowKeys(empty).get("permissions")], []);
    assert.deepEqual([...workflowJobs(empty)[0].keys.get("permissions")], []);
    assert.deepEqual([...workflowSteps(empty)[0].env], []);
  });

  it("reads step env keys quoted or bare, and a comment-only value as empty", () => {
    const report = workflowSteps(file).find((s) => s.name === "Report");
    assert.equal(report.jobId, "build");
    assert.equal(report.env.get("PLAIN"), "value");
    assert.equal(report.env.get("QUOTED"), "a, b");
    assert.equal(report.env.get("EMPTY"), "");
  });
});
