import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { VERIFY_DEPLOYMENTS_CONFIG } from "../deploy-alert.mjs";

// Pins the wiring that makes a failed staging API deploy raise an alert
// (#2431), and rehearses it.
//
// `verify-deployments.yml` went red on at least ten straight pushes to `main`
// while nothing alerted. Its `deploy-outcome` job now reports through
// `deploy-alert.mjs`, and every piece of that is a string the two files share
// with nothing to check them: the job name the config reads from `needs`, the
// `outcome` output the verifier publishes and the job re-exports, the step id
// between them, and `ALERT_CONFIG`. A drift in any of them fails quietly: a
// broken output mapping makes every green run a no-op, so the alert still
// opens but never closes.
//
// The rehearsal at the bottom is #2431's "proven by a rehearsed equivalent":
// it runs `deploy-alert.mjs` as a process, with the env block read out of this
// workflow and the `needs` JSON GitHub renders, against a stubbed GitHub API.
// It does not replace the live drill (#2505's paging drill: a deliberately
// broken staging deploy reaching the owner's phone).
//
// Parsed by hand rather than with a YAML library, matching
// `deploy-vercel-staging-workflow.test.mjs`.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO, ".github", "workflows", "verify-deployments.yml");
const DEPLOY_ALERT = join(REPO, "scripts", "ci", "deploy-alert.mjs");

const text = readFileSync(WORKFLOW, "utf8");
const uncommentedLines = text.split("\n").filter((line) => !/^\s*#/.test(line));
const uncommented = uncommentedLines.join("\n");

/** { jobName: blockText } for every job under `jobs:`. */
function jobBlocks() {
  const start = uncommentedLines.findIndex((line) => line === "jobs:");
  assert.ok(start >= 0, "no top-level jobs: key");
  const blocks = {};
  let current = null;
  for (const line of uncommentedLines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      blocks[current] = [];
    } else if (/^\S/.test(line)) {
      break;
    } else if (current) {
      blocks[current].push(line);
    }
  }
  return Object.fromEntries(Object.entries(blocks).map(([name, lines]) => [name, lines.join("\n")]));
}

/** The `env:` map of the step named `stepName` inside `block`. */
function stepEnv(block, stepName) {
  const lines = block.split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.ok(at >= 0, `no step named ${stepName}`);
  const envAt = lines.findIndex((line, i) => i > at && line.trim() === "env:");
  assert.ok(envAt > at, `step ${stepName} has no env:`);
  const envIndent = lines[envAt].search(/\S/);
  const env = {};
  for (const line of lines.slice(envAt + 1)) {
    if (line.trim() === "") continue;
    if (line.search(/\S/) <= envIndent) break;
    const m = /^\s*([A-Z0-9_]+):\s*(.*)$/.exec(line);
    assert.ok(m, `unparsed env line: ${line}`);
    env[m[1]] = m[2];
  }
  return env;
}

const jobs = jobBlocks();
const JOB = VERIFY_DEPLOYMENTS_CONFIG.deployJobs[0];
const OUTPUT = VERIFY_DEPLOYMENTS_CONFIG.deployedOutput.output;
const REPORT_STEP = "Report deploy outcome and alert on failure";

describe("verify-deployments.yml", () => {
  it("reads the workflow at all", () => {
    // A path typo would make every assertion below pass vacuously.
    assert.ok(text.length > 500, "expected the workflow file, got something too short");
    assert.match(uncommented, /^name: Verify deployments$/m);
    assert.deepEqual(Object.keys(jobs).sort(), ["deploy-outcome", "verify-render-api"]);
  });

  it("still observes pushes to main, so HEAD_BRANCH and HEAD_SHA come from the push", () => {
    assert.match(uncommented, /^on:\n {2}push:\n {4}branches: \[main\]$/m);
    assert.doesNotMatch(uncommented, /workflow_run/);
  });

  it("the config reads the job this workflow actually runs", () => {
    assert.deepEqual(VERIFY_DEPLOYMENTS_CONFIG.deployJobs, ["verify-render-api"]);
    assert.ok(Object.hasOwn(jobs, JOB), `no ${JOB} job`);
    assert.equal(VERIFY_DEPLOYMENTS_CONFIG.workflowFile, ".github/workflows/verify-deployments.yml");
  });

  it("re-exports the verifier's verdict as the job output the config reads", () => {
    // Break any link in this chain and a live deploy can never close the
    // alert: `deploy-outcome` sees `success` with no verdict and warns.
    const block = jobs[JOB];
    assert.match(
      block,
      new RegExp(`^ {4}outputs:\\n {6}${OUTPUT}: \\$\\{\\{ steps\\.verify\\.outputs\\.${OUTPUT} \\}\\}$`, "m"),
    );
    assert.match(
      block,
      /- name: Verify Render API deploy\n\s+id: verify\n[\s\S]*?run: node scripts\/ci\/verify-render-deploy\.mjs/,
    );
  });

  it("names the commit with DEPLOY_SHA, never a step-level GITHUB_SHA", () => {
    // `GITHUB_` is a reserved prefix: a step-level `GITHUB_SHA:` is ignored.
    const env = stepEnv(jobs[JOB], "Verify Render API deploy");
    assert.equal(env.DEPLOY_SHA, "${{ github.sha }}");
    assert.doesNotMatch(uncommented, /^\s+GITHUB_SHA:/m);
  });

  it("reports after the verifier, on every outcome but a cancelled run", () => {
    const block = jobs["deploy-outcome"];
    assert.match(block, /^ {4}needs: \[verify-render-api\]$/m);
    // `always()` would file a P1 when someone cancels the observer, which
    // stops the watching, not the Render deploy.
    assert.match(block, /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
  });

  it("holds the only write scope, job-scoped, and no credential environment", () => {
    const block = jobs["deploy-outcome"];
    assert.match(block, /^ {4}permissions:\n {6}contents: read\n {6}issues: write$/m);
    // It needs only its own GITHUB_TOKEN. Naming `staging` would put it
    // behind that environment's rules for no secret it uses.
    assert.doesNotMatch(block, /^ {4}environment:/m);
    assert.doesNotMatch(jobs[JOB], /issues: write/);
    assert.match(uncommented, /^permissions:\n {2}contents: read$/m);
  });

  it("calls deploy-alert.mjs with this workflow's configuration", () => {
    const env = stepEnv(jobs["deploy-outcome"], REPORT_STEP);
    assert.equal(env.ALERT_CONFIG, VERIFY_DEPLOYMENTS_CONFIG.name);
    assert.equal(env.DEPLOY_NEEDS, "${{ toJSON(needs) }}");
    assert.equal(env.HEAD_BRANCH, "${{ github.ref_name }}");
    assert.equal(env.HEAD_SHA, "${{ github.sha }}");
    assert.equal(env.GITHUB_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
    assert.match(jobs["deploy-outcome"], /run: node scripts\/ci\/deploy-alert\.mjs$/m);
  });
});

// ── Rehearsal ───────────────────────────────────────────────────────────────

const TOKEN = "ghs_rehearsalTokenValue0123456789";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const REPOSITORY = "pdcarlson/Frapp";
const RUN_ID = "4242";

/** The values Actions substitutes into the reporting step's env. */
function expressionValues(needs) {
  return {
    "secrets.GITHUB_TOKEN": TOKEN,
    "toJSON(needs)": JSON.stringify(needs),
    "github.server_url": "https://github.com",
    "github.repository": REPOSITORY,
    "github.run_id": RUN_ID,
    "github.ref_name": "main",
    "github.sha": SHA,
  };
}

/** The step's env block with its expressions evaluated. Unknown ones fail. */
function renderedEnv(needs) {
  const values = expressionValues(needs);
  const env = {};
  for (const [key, raw] of Object.entries(stepEnv(jobs["deploy-outcome"], REPORT_STEP))) {
    env[key] = raw.replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_, expr) => {
      assert.ok(Object.hasOwn(values, expr), `rehearsal does not model \${{ ${expr} }}`);
      return values[expr];
    });
  }
  return env;
}

// Replaces global fetch in the child with a GitHub API stand-in that records
// every request. `deploy-alert.mjs`'s CLI resolves `fetch` at call time, so a
// preload is enough; nothing in the script changes for the test.
const STUB = `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  const path = String(url).replace("https://api.github.com", "");
  appendFileSync(process.env.STUB_FETCH_LOG, JSON.stringify({
    method, path, authorization: init.headers?.Authorization ?? null, body: init.body ?? null,
  }) + "\\n");
  let status = 404;
  let data = { message: "unexpected route" };
  if (method === "GET" && path.startsWith("/repos/")) {
    status = 200;
    data = JSON.parse(process.env.STUB_ISSUES);
  } else if (method === "POST" && /\\/issues$/.test(path)) {
    status = 201;
    data = { number: 4343 };
  } else if (method === "POST" && /\\/comments$/.test(path)) {
    status = 201;
    data = { id: 1 };
  } else if (method === "PATCH" && /\\/issues\\/\\d+$/.test(path)) {
    status = 200;
    data = { number: Number(path.split("/").pop()) };
  }
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
};
`;

describe("rehearsal: deploy-outcome as Actions would run it", () => {
  let dir;
  let run = 0;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "verify-deployments-rehearsal-"));
    writeFileSync(join(dir, "stub-fetch.mjs"), STUB);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function rehearse({ needs, issues = [] }) {
    run += 1;
    const log = join(dir, `requests-${run}.jsonl`);
    const summaryFile = join(dir, `summary-${run}.md`);
    const result = spawnSync(
      process.execPath,
      ["--import", join(dir, "stub-fetch.mjs"), DEPLOY_ALERT],
      {
        encoding: "utf8",
        // Only what the runner provides plus the step's own env: nothing from
        // this test process leaks in to make the rehearsal pass.
        env: {
          ...renderedEnv(needs),
          GITHUB_ACTIONS: "true",
          GITHUB_REPOSITORY: REPOSITORY,
          GITHUB_STEP_SUMMARY: summaryFile,
          STUB_FETCH_LOG: log,
          STUB_ISSUES: JSON.stringify(issues),
        },
      },
    );
    const requests = existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
          .map((r) => ({ ...r, body: r.body ? JSON.parse(r.body) : null }))
      : [];
    const summary = existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : "";
    return { ...result, requests, summary };
  }

  const openAlert = {
    number: 960,
    state: "open",
    title: VERIFY_DEPLOYMENTS_CONFIG.alertTitle,
    labels: [{ name: "routine-state" }],
  };

  it("a build_failed deploy files the alert issue, and prints no token anywhere", () => {
    // `writeOutcomeOutput` runs before the verifier exits 1, so a failed
    // verify still publishes `failure`; the alert reads only the job result.
    const out = rehearse({
      needs: { "verify-render-api": { result: "failure", outputs: { outcome: "failure" } } },
    });
    assert.equal(out.status, 0, out.stderr);

    const create = out.requests.find((r) => r.method === "POST" && r.path === `/repos/${REPOSITORY}/issues`);
    assert.ok(create, `no issue created; requests: ${JSON.stringify(out.requests)}`);
    assert.equal(create.body.title, VERIFY_DEPLOYMENTS_CONFIG.alertTitle);
    assert.ok(create.body.labels.includes("routine-state"));
    assert.match(create.body.body, new RegExp(SHA));
    assert.match(create.body.body, new RegExp(`https://github\\.com/${REPOSITORY}/actions/runs/${RUN_ID}`));
    assert.match(out.stdout, /::error::Verify deployments FAILED on `main`/);
    assert.match(out.summary, /FAILED — deploy not confirmed live/);

    // #2431's last criterion: the token reaches only the Authorization header.
    for (const [surface, value] of [
      ["stdout", out.stdout],
      ["stderr", out.stderr],
      ["summary", out.summary],
      ["issue body", JSON.stringify(out.requests.map((r) => r.body))],
    ]) {
      assert.ok(!value.includes(TOKEN), `token printed to ${surface}`);
    }
    assert.ok(out.requests.every((r) => r.authorization === `Bearer ${TOKEN}`));
  });

  it("a confirmed live deploy closes the open alert", () => {
    const out = rehearse({
      needs: { "verify-render-api": { result: "success", outputs: { outcome: "success" } } },
      issues: [openAlert],
    });
    assert.equal(out.status, 0, out.stderr);
    const close = out.requests.find((r) => r.method === "PATCH" && r.path === `/repos/${REPOSITORY}/issues/960`);
    assert.ok(close, `alert not closed; requests: ${JSON.stringify(out.requests)}`);
    assert.equal(close.body.state, "closed");
  });

  it("a superseded deploy leaves the open alert alone", () => {
    const out = rehearse({
      needs: { "verify-render-api": { result: "success", outputs: { outcome: "neutral" } } },
      issues: [openAlert],
    });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(out.requests.filter((r) => r.method !== "GET"), []);
    assert.match(out.summary, /NO-OP — nothing confirmed/);
  });
});
