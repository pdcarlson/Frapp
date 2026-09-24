import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { VERIFY_DEPLOYMENTS_CONFIG } from "../deploy-alert.mjs";
import { workflowJobs, workflowKeys, workflowSteps } from "./helpers/workflow-yaml.mjs";

// Pins the wiring that makes a failed staging API deploy raise an alert
// (#2431), and rehearses it.
//
// `verify-deployments.yml` went red on at least ten straight pushes to `main`
// while nothing alerted. Its `deploy-outcome` job now reports through
// `deploy-alert.mjs`, and every piece of that is a string the files share with
// nothing to check them: the job name the config reads from `needs`, the
// `outcome` output the verifier writes and the job re-exports, the step id
// between them, and `ALERT_CONFIG`. A drift in any of them fails quietly: a
// broken output chain makes every green run a no-op, so the alert still opens
// but never closes.
//
// The rehearsals at the bottom are #2431's "proven by a rehearsed equivalent".
// They run the real `verify-render-deploy.mjs` CLI against a stubbed Render
// API, with the env block read out of this workflow, then build `needs` from
// what it actually wrote to `$GITHUB_OUTPUT` and its exit code, and run the
// real `deploy-alert.mjs` CLI on that against a stubbed GitHub API. They don't
// replace the live drill (#2505's paging drill: a deliberately broken staging
// deploy reaching the owner's phone).
//
// Read through `helpers/workflow-yaml.mjs` rather than regexes over the text,
// so a quoted value, an inline comment or a flow mapping on a correct workflow
// cannot fail a guard, and a guard on a whole block (`permissions:`) cannot
// pass on its first line alone.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO, ".github", "workflows", "verify-deployments.yml");
const VERIFIER = join(REPO, "scripts", "ci", "verify-render-deploy.mjs");
const DEPLOY_ALERT = join(REPO, "scripts", "ci", "deploy-alert.mjs");

const text = readFileSync(WORKFLOW, "utf8");
const significant = text
  .split("\n")
  .filter((line) => line.trim() !== "" && !/^\s*#/.test(line))
  .join("\n");

const top = workflowKeys(WORKFLOW);
const jobs = new Map(workflowJobs(WORKFLOW).map((job) => [job.jobId, job]));
const steps = workflowSteps(WORKFLOW);

const VERIFY_JOB = VERIFY_DEPLOYMENTS_CONFIG.deployJobs[0];
const OUTPUT = VERIFY_DEPLOYMENTS_CONFIG.deployedOutput.output;
const VERIFY_STEP = "Verify Render API deploy";
const REPORT_STEP = "Report deploy outcome and alert on failure";

function step(jobId, name) {
  const found = steps.find((s) => s.jobId === jobId && s.name === name);
  assert.ok(found, `no step "${name}" in job ${jobId}`);
  return found;
}

/** The step id an output expression reads, e.g. `${{ steps.verify.outputs.outcome }}`. */
function outputSource(expression) {
  const m = /^\$\{\{\s*steps\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}$/.exec(expression ?? "");
  assert.ok(m, `not a step-output expression: ${expression}`);
  return { stepId: m[1], name: m[2] };
}

/** A step's `id:`, read from its own text. */
function stepId(s) {
  return /^\s*-?\s*id:\s*["']?([\w-]+)["']?\s*(?:#.*)?$/m.exec(s.body)?.[1] ?? null;
}

describe("verify-deployments.yml", () => {
  it("reads the workflow at all", () => {
    // A path typo would make every assertion below pass vacuously.
    assert.ok(text.length > 500, "expected the workflow file, got something too short");
    assert.equal(top.get("name"), "Verify deployments");
    assert.deepEqual([...jobs.keys()].sort(), ["deploy-outcome", "verify-render-api"]);
  });

  it("still observes pushes to main, so HEAD_BRANCH and HEAD_SHA come from the push", () => {
    // Only `push`: a `workflow_run` or `pull_request` trigger would change
    // what `github.sha` and `github.ref_name` name.
    assert.deepEqual([...top.get("on").keys()], ["push"]);
    assert.match(significant, /^ {2}push:\n {4}branches:\s*\[\s*["']?main["']?\s*\]\s*$/m);
  });

  it("the config reads the job this workflow actually runs", () => {
    assert.deepEqual(VERIFY_DEPLOYMENTS_CONFIG.deployJobs, ["verify-render-api"]);
    assert.ok(jobs.has(VERIFY_JOB), `no ${VERIFY_JOB} job`);
    assert.equal(VERIFY_DEPLOYMENTS_CONFIG.workflowFile, ".github/workflows/verify-deployments.yml");
  });

  it("re-exports the verifier's verdict as the job output the config reads", () => {
    // Break any link in this chain and a live deploy can never close the
    // alert: `deploy-outcome` sees `success` with no verdict and warns.
    const outputs = jobs.get(VERIFY_JOB).keys.get("outputs");
    assert.ok(outputs instanceof Map, "verify-render-api declares no outputs:");
    const source = outputSource(outputs.get(OUTPUT));
    assert.equal(source.name, "outcome", "the verifier writes `outcome`");
    const verifyStep = step(VERIFY_JOB, VERIFY_STEP);
    assert.equal(stepId(verifyStep), source.stepId, "the output reads a step id the verifier step lacks");
    assert.match(verifyStep.body, /run: node scripts\/ci\/verify-render-deploy\.mjs\s*$/m);
  });

  it("names the commit with DEPLOY_SHA, never a GITHUB_SHA override", () => {
    // `GITHUB_` is a reserved prefix: an `env:` `GITHUB_SHA:` is ignored.
    assert.equal(step(VERIFY_JOB, VERIFY_STEP).env.get("DEPLOY_SHA"), "${{ github.sha }}");
    for (const s of steps) {
      assert.ok(!s.env.has("GITHUB_SHA"), `${s.jobId} / ${s.name} sets GITHUB_SHA`);
    }
  });

  it("reports after the verifier, on every outcome but a cancelled run", () => {
    const job = jobs.get("deploy-outcome");
    assert.equal(job.keys.get("needs"), "[verify-render-api]");
    // `always()` would file a P1 when someone cancels the observer, which
    // stops the watching, not the Render deploy.
    assert.equal(job.if, "${{ !cancelled() }}");
  });

  it("holds the only write scope, job-scoped, and no credential environment", () => {
    const job = jobs.get("deploy-outcome");
    assert.deepEqual(Object.fromEntries(job.keys.get("permissions")), {
      contents: "read",
      issues: "write",
    });
    // It needs only its own GITHUB_TOKEN. Naming `staging` would put it
    // behind that environment's rules for no secret it uses.
    assert.ok(!job.keys.has("environment"), "deploy-outcome names an environment");
    // The verifier holds RENDER_API_KEY and inherits the workflow-level token,
    // so that block is asserted whole: a write scope added under it is caught.
    assert.ok(!jobs.get(VERIFY_JOB).keys.has("permissions"), "the verifier gained a permissions block");
    assert.deepEqual(Object.fromEntries(top.get("permissions")), { contents: "read" });
  });

  it("calls deploy-alert.mjs with this workflow's configuration", () => {
    const report = step("deploy-outcome", REPORT_STEP);
    assert.equal(report.env.get("ALERT_CONFIG"), VERIFY_DEPLOYMENTS_CONFIG.name);
    assert.equal(report.env.get("DEPLOY_NEEDS"), "${{ toJSON(needs) }}");
    assert.equal(report.env.get("HEAD_BRANCH"), "${{ github.ref_name }}");
    assert.equal(report.env.get("HEAD_SHA"), "${{ github.sha }}");
    assert.equal(report.env.get("GITHUB_TOKEN"), "${{ secrets.GITHUB_TOKEN }}");
    assert.match(report.body, /run: node scripts\/ci\/deploy-alert\.mjs\s*$/m);
  });
});

// ── Rehearsal ───────────────────────────────────────────────────────────────

const GITHUB_TOKEN = "ghs_rehearsalTokenValue0123456789";
const RENDER_KEY = "render-rehearsal-key-not-a-secret";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const REPOSITORY = "pdcarlson/Frapp";
const RUN_ID = "4242";

/** The values Actions substitutes into the two steps' env. Unknown ones fail. */
function expressionValues(needs) {
  return {
    "secrets.GITHUB_TOKEN": GITHUB_TOKEN,
    "secrets.RENDER_API_KEY": RENDER_KEY,
    "toJSON(needs)": JSON.stringify(needs),
    "github.server_url": "https://github.com",
    "github.repository": REPOSITORY,
    "github.run_id": RUN_ID,
    "github.ref_name": "main",
    "github.sha": SHA,
  };
}

function renderedEnv(stepEnv, needs = null) {
  const values = expressionValues(needs);
  const env = {};
  for (const [key, raw] of stepEnv) {
    env[key] = raw.replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_, expr) => {
      assert.ok(Object.hasOwn(values, expr), `rehearsal does not model \${{ ${expr} }}`);
      return values[expr];
    });
  }
  return env;
}

// Replaces global fetch in a child process with stand-ins for the Render and
// GitHub APIs, recording every request. Both scripts resolve `fetch` at call
// time, so a preload is enough; neither script changes for the test.
// `STUB_RENDER` is the sequence of Render responses, one per request, the last
// repeating: `{ status, deploys }`.
const STUB = `
import { appendFileSync } from "node:fs";
const render = JSON.parse(process.env.STUB_RENDER ?? "[]");
let renderCall = 0;
const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method ?? "GET";
  const headers = init.headers ?? {};
  appendFileSync(process.env.STUB_FETCH_LOG, JSON.stringify({
    method, url, authorization: headers.Authorization ?? headers.authorization ?? null, body: init.body ?? null,
  }) + "\\n");
  if (url.startsWith("https://api.render.com/")) {
    const r = render[Math.min(renderCall, render.length - 1)];
    renderCall += 1;
    return r.status === 200
      ? json(200, r.deploys.map((d) => ({ deploy: d, cursor: "c-" + d.id })))
      : json(r.status, { message: "stub " + r.status });
  }
  const path = url.replace("https://api.github.com", "");
  if (method === "GET" && path.startsWith("/repos/")) return json(200, JSON.parse(process.env.STUB_ISSUES ?? "[]"));
  if (method === "POST" && /\\/issues$/.test(path)) return json(201, { number: 4343 });
  if (method === "POST" && /\\/comments$/.test(path)) return json(201, { id: 1 });
  if (method === "PATCH" && /\\/issues\\/\\d+$/.test(path)) return json(200, { number: Number(path.split("/").pop()) });
  return json(404, { message: "unexpected route" });
};
`;

function renderDeploy(status) {
  return { id: `dep-${status}`, status, commit: { id: SHA }, createdAt: "2026-09-24T00:00:00Z" };
}

describe("rehearsal: verify-render-api then deploy-outcome, as Actions would run them", () => {
  let dir;
  let run = 0;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "verify-deployments-rehearsal-"));
    writeFileSync(join(dir, "stub-fetch.mjs"), STUB);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readLog(path) {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .map((r) => ({ ...r, body: r.body ? JSON.parse(r.body) : null }));
  }

  function spawnWithStub(script, env) {
    return spawnSync(process.execPath, ["--import", join(dir, "stub-fetch.mjs"), script], {
      encoding: "utf8",
      // Only what the runner provides plus the step's own env: nothing from
      // this test process leaks in to make the rehearsal pass.
      env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: REPOSITORY, ...env },
    });
  }

  /**
   * Runs the verifier step, derives `needs` from what it wrote and how it
   * exited (through the job's own `outputs:` mapping), then the report step.
   */
  function rehearse({ render, issues = [] }) {
    run += 1;
    const verifierLog = join(dir, `verifier-${run}.jsonl`);
    const alertLog = join(dir, `alert-${run}.jsonl`);
    const outputFile = join(dir, `output-${run}`);
    const summaryFile = join(dir, `summary-${run}.md`);
    writeFileSync(outputFile, "");

    const verifier = spawnWithStub(VERIFIER, {
      ...renderedEnv(step(VERIFY_JOB, VERIFY_STEP).env),
      GITHUB_OUTPUT: outputFile,
      STUB_FETCH_LOG: verifierLog,
      STUB_RENDER: JSON.stringify(render),
    });

    const written = Object.fromEntries(
      readFileSync(outputFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    const outputs = {};
    for (const [key, expression] of jobs.get(VERIFY_JOB).keys.get("outputs")) {
      const source = outputSource(expression);
      assert.equal(source.stepId, stepId(step(VERIFY_JOB, VERIFY_STEP)));
      if (Object.hasOwn(written, source.name)) outputs[key] = written[source.name];
    }
    const needs = {
      [VERIFY_JOB]: { result: verifier.status === 0 ? "success" : "failure", outputs },
    };

    const alert = spawnWithStub(DEPLOY_ALERT, {
      ...renderedEnv(step("deploy-outcome", REPORT_STEP).env, needs),
      GITHUB_STEP_SUMMARY: summaryFile,
      STUB_FETCH_LOG: alertLog,
      STUB_ISSUES: JSON.stringify(issues),
    });

    return {
      verifier,
      written,
      needs,
      alert,
      renderRequests: readLog(verifierLog),
      githubRequests: readLog(alertLog),
      summary: existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : "",
    };
  }

  const openAlert = {
    number: 960,
    state: "open",
    title: VERIFY_DEPLOYMENTS_CONFIG.alertTitle,
    labels: [{ name: "routine-state" }],
  };

  it("a build_failed deploy files the alert issue, and prints neither credential anywhere", () => {
    const out = rehearse({ render: [{ status: 200, deploys: [renderDeploy("build_failed")] }] });
    assert.equal(out.verifier.status, 1, out.verifier.stderr);
    assert.deepEqual(out.written, { outcome: "failure" });
    assert.equal(out.alert.status, 0, out.alert.stderr);

    const create = out.githubRequests.find(
      (r) => r.method === "POST" && r.url === `https://api.github.com/repos/${REPOSITORY}/issues`,
    );
    assert.ok(create, `no issue created; requests: ${JSON.stringify(out.githubRequests)}`);
    assert.equal(create.body.title, VERIFY_DEPLOYMENTS_CONFIG.alertTitle);
    assert.ok(create.body.labels.includes("routine-state"));
    assert.match(create.body.body, new RegExp(SHA));
    assert.match(create.body.body, new RegExp(`https://github\\.com/${REPOSITORY}/actions/runs/${RUN_ID}`));
    assert.match(out.alert.stdout, /::error::Verify deployments FAILED on `main`/);
    assert.match(out.summary, /FAILED — deploy not confirmed live/);

    // #2431's last criterion. Each credential reaches only its own
    // Authorization header: never a log line, the summary, or an issue body.
    for (const secret of [GITHUB_TOKEN, RENDER_KEY]) {
      for (const [surface, value] of [
        ["verifier stdout", out.verifier.stdout],
        ["verifier stderr", out.verifier.stderr],
        ["step output", JSON.stringify(out.written)],
        ["alert stdout", out.alert.stdout],
        ["alert stderr", out.alert.stderr],
        ["summary", out.summary],
        ["issue body", JSON.stringify(out.githubRequests.map((r) => r.body))],
      ]) {
        assert.ok(!value.includes(secret), `a credential was printed to ${surface}`);
      }
    }
    assert.ok(out.renderRequests.every((r) => r.authorization === `Bearer ${RENDER_KEY}`));
    assert.ok(out.githubRequests.every((r) => r.authorization === `Bearer ${GITHUB_TOKEN}`));
  });

  it("a live deploy publishes `success` and closes the open alert", () => {
    const out = rehearse({
      render: [{ status: 200, deploys: [renderDeploy("live")] }],
      issues: [openAlert],
    });
    assert.equal(out.verifier.status, 0, out.verifier.stderr);
    assert.deepEqual(out.written, { outcome: "success" });
    const close = out.githubRequests.find(
      (r) => r.method === "PATCH" && r.url === `https://api.github.com/repos/${REPOSITORY}/issues/960`,
    );
    assert.ok(close, `alert not closed; requests: ${JSON.stringify(out.githubRequests)}`);
    assert.equal(close.body.state, "closed");
    assert.ok(!out.alert.stdout.includes("::warning::"), out.alert.stdout);
  });

  it("a superseded deploy publishes `neutral` and leaves the open alert alone", () => {
    const out = rehearse({
      render: [{ status: 200, deploys: [renderDeploy("canceled")] }],
      issues: [openAlert],
    });
    assert.equal(out.verifier.status, 0, out.verifier.stderr);
    assert.deepEqual(out.written, { outcome: "neutral" });
    assert.deepEqual(out.githubRequests.filter((r) => r.method !== "GET"), []);
    assert.match(out.summary, /NO-OP — nothing confirmed/);
  });

  it("one transient Render 502 is retried, not turned into a P1", () => {
    // Without the retry, this blip was a failure verdict on the first poll.
    const out = rehearse({
      render: [
        { status: 502 },
        { status: 200, deploys: [renderDeploy("live")] },
      ],
      issues: [openAlert],
    });
    assert.equal(out.verifier.status, 0, out.verifier.stderr);
    assert.equal(out.renderRequests.length, 2, "expected the 502 to be re-sent once");
    assert.deepEqual(out.written, { outcome: "success" });
    assert.ok(!out.githubRequests.some((r) => r.method === "POST" && r.url.endsWith("/issues")));
  });
});
