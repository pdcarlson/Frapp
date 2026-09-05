import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ALERT_CONFIGS,
  ALERT_ISSUE_LABELS,
  ALERT_ISSUE_TITLE,
  DEPLOY_API_CONFIG,
  DEPLOY_VERCEL_STAGING_CONFIG,
  alertJobNames,
  buildAlertIssueBody,
  buildHeadline,
  buildRunSummary,
  classifyDeployOutcome,
  findAlertIssues,
  raiseAlert,
  readJobResults,
  resolveAlert,
  resolveAlertConfig,
  runDeployAlert,
} from "../deploy-alert.mjs";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Modeled on the two real shapes measured in #763 over 90 runs on main:
//   * 44 runs where check-changes said api-changed=true and the deploy job then
//     failed at the Infisical injection step (run 31278413630);
//   * 46 runs where every deploy/migrate job skipped and the run reported green
//     (run 31278674931) — the "green because empty" case.

/** `toJSON(needs)` for a run where the path gate skipped everything. */
function noOpNeeds() {
  return {
    "check-changes": {
      result: "success",
      outputs: { "api-changed": "false", "migrations-changed": "false" },
    },
    "migrate-staging": { result: "skipped", outputs: {} },
    "deploy-staging": { result: "skipped", outputs: {} },
  };
}

/** Run 31278413630's shape: api changed, staging deploy failed, migrate skipped. */
function failedNeeds() {
  return {
    "check-changes": {
      result: "success",
      outputs: { "api-changed": "true", "migrations-changed": "false" },
    },
    "migrate-staging": { result: "skipped", outputs: {} },
    "deploy-staging": { result: "failure", outputs: {} },
  };
}

function deployedNeeds() {
  return {
    "check-changes": {
      result: "success",
      outputs: { "api-changed": "true", "migrations-changed": "true" },
    },
    "migrate-staging": { result: "success", outputs: {} },
    "deploy-staging": { result: "success", outputs: {} },
  };
}

const OPEN_ALERT = {
  number: 900,
  title: ALERT_ISSUE_TITLE,
  state: "open",
};
const CLOSED_ALERT = {
  number: 900,
  title: ALERT_ISSUE_TITLE,
  state: "closed",
};

/**
 * Minimal GitHub API stub. `routes` maps "METHOD /path-prefix" to a response
 * body (or a function of the request). Records every call for assertions.
 */
function makeFetchStub({ issues = [], failCreate = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? "GET";
    const path = url.replace("https://api.github.com", "");
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path, body });

    if (method === "GET" && path.startsWith("/repos/o/r/issues?")) {
      return jsonResponse(200, issues);
    }
    if (method === "POST" && path === "/repos/o/r/issues") {
      if (failCreate) return jsonResponse(422, { message: "boom" });
      return jsonResponse(201, { number: 901 });
    }
    if (method === "POST" && /\/issues\/\d+\/comments$/.test(path)) {
      return jsonResponse(201, { id: 1 });
    }
    if (method === "PATCH" && /\/issues\/\d+$/.test(path)) {
      return jsonResponse(200, { number: 900 });
    }
    return jsonResponse(404, { message: "unexpected route" });
  };
  return { fetchImpl, calls };
}

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  };
}

const silentLogger = { log: () => {} };

function capturingLogger() {
  const lines = [];
  return { logger: { log: (line) => lines.push(line) }, lines };
}

// ── Alert issue identity ────────────────────────────────────────────────────

test("the alert issue title is NOT rescoped to staging", () => {
  // #1340 narrowed this watchdog to staging (the production jobs moved to
  // deploy-production.yml), and the obvious tidy-up is to say "staging" in the
  // title. Don't: `findAlertIssues` looks the issue up by EXACT title, so a
  // rename orphans whatever alert is open right now — it can never be found
  // again, and therefore never self-closes. The stale-sounding title is load
  // bearing.
  assert.equal(
    ALERT_ISSUE_TITLE,
    "Deploy API is failing — pushes are not reaching the environment",
  );
});

// ── readJobResults ──────────────────────────────────────────────────────────

test("readJobResults flattens the needs context", () => {
  assert.deepEqual(readJobResults(failedNeeds()), {
    "check-changes": "success",
    "migrate-staging": "skipped",
    "deploy-staging": "failure",
  });
});

test("readJobResults reads a missing job as skipped rather than throwing", () => {
  // A future rename in deploy-api.yml must degrade to silence, not a red run.
  const results = readJobResults({ "check-changes": { result: "success" } });
  assert.equal(results["deploy-staging"], "skipped");
  assert.doesNotThrow(() => readJobResults(undefined));
});

// ── classifyDeployOutcome ───────────────────────────────────────────────────

test("a failed deploy job classifies as failed", () => {
  const result = classifyDeployOutcome({ jobResults: readJobResults(failedNeeds()) });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.failed, ["deploy-staging"]);
});

test("all-skipped classifies as no-op, not as a deploy", () => {
  const result = classifyDeployOutcome({ jobResults: readJobResults(noOpNeeds()) });
  assert.equal(result.outcome, "no-op");
  assert.deepEqual(result.deployed, []);
});

test("check-changes succeeding is not itself a deploy", () => {
  // The regression this guards: counting the gate as a deployed job would make
  // every green-because-empty run look like a successful deploy.
  const result = classifyDeployOutcome({ jobResults: readJobResults(noOpNeeds()) });
  assert.ok(!result.deployed.includes("check-changes"));
});

test("successful migrate + deploy classifies as deployed", () => {
  const result = classifyDeployOutcome({ jobResults: readJobResults(deployedNeeds()) });
  assert.equal(result.outcome, "deployed");
  assert.deepEqual(result.deployed, ["migrate-staging", "deploy-staging"]);
});

test("a failed gate job classifies as failed even though nothing deployed", () => {
  const needs = noOpNeeds();
  needs["check-changes"].result = "failure";
  const result = classifyDeployOutcome({ jobResults: readJobResults(needs) });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.failed, ["check-changes"]);
});

test("cancelled and timed_out count as failures, not as benign", () => {
  for (const badResult of ["cancelled", "timed_out"]) {
    const needs = failedNeeds();
    needs["deploy-staging"].result = badResult;
    const result = classifyDeployOutcome({ jobResults: readJobResults(needs) });
    assert.equal(result.outcome, "failed", `${badResult} should alert`);
  }
});

test("failure wins over a sibling success", () => {
  const needs = deployedNeeds();
  needs["deploy-staging"].result = "failure";
  const result = classifyDeployOutcome({ jobResults: readJobResults(needs) });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.deployed, ["migrate-staging"]);
});

// ── Summary / headline copy ─────────────────────────────────────────────────

test("the no-op headline says plainly that nothing deployed", () => {
  const headline = buildHeadline({
    outcome: "no-op",
    failed: [],
    deployed: [],
    headBranch: "main",
  });
  assert.match(headline, /deployed NOTHING/);
  assert.match(headline, /green because it declined to deploy/);
});

test("the run summary distinguishes a no-op from a deploy at a glance", () => {
  const summary = buildRunSummary({
    outcome: "no-op",
    failed: [],
    deployed: [],
    jobResults: readJobResults(noOpNeeds()),
    headBranch: "main",
    headSha: "4de96af",
    runUrl: "https://example.test/run/1",
    gateOutputs: { "api-changed": false, "migrations-changed": false },
    gateSucceeded: true,
  });
  assert.match(summary, /\| API paths changed \| no \|/);
  assert.match(summary, /NO-OP — nothing deployed/);
  assert.match(summary, /#763/);
  // Every job's result is spelled out so no inference from skipped jobs is needed.
  assert.match(summary, /\| `deploy-staging` \| skipped \|/);
});

test("the failed summary names the failing job and the commit", () => {
  const summary = buildRunSummary({
    outcome: "failed",
    failed: ["deploy-staging"],
    deployed: [],
    jobResults: readJobResults(failedNeeds()),
    headBranch: "main",
    headSha: "4de96af",
    runUrl: "https://example.test/run/1",
    gateOutputs: { "api-changed": true, "migrations-changed": false },
    gateSucceeded: true,
  });
  assert.match(summary, /FAILED — nothing deployed/);
  assert.match(summary, /deploy-staging/);
  assert.match(summary, /4de96af/);
});

test("a failed gate reports the path flags as unknown, never as 'no'", async () => {
  // The gate's outputs are empty when it fails, which is NOT the same as "no
  // paths changed" — rendering the absent output as `no` states an unmeasured
  // value as fact.
  const needs = noOpNeeds();
  needs["check-changes"].result = "failure";
  needs["check-changes"].outputs = {};

  let summary = "";
  await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs,
    runUrl: "https://example.test/run/4",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl: makeFetchStub({ issues: [] }).fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
  });

  assert.match(summary, /\| API paths changed \| unknown \|/);
  assert.match(summary, /\| Migration paths changed \| unknown \|/);
  assert.doesNotMatch(summary, /paths changed \| no \|/);
});

test("findAlertIssues pins the sort order it depends on", async () => {
  // raiseAlert reopens the FIRST match as "most recent"; that must not rely on
  // an unstated API default.
  const paths = [];
  const fetchImpl = async (url) => {
    paths.push(url);
    return jsonResponse(200, []);
  };
  await findAlertIssues({ token: "t", repo: "o/r", fetchImpl });
  assert.match(paths[0], /sort=created/);
  assert.match(paths[0], /direction=desc/);
});

// ── findAlertIssues ─────────────────────────────────────────────────────────

test("findAlertIssues ignores pull requests and foreign titles", () => {
  const { fetchImpl } = makeFetchStub({
    issues: [
      { number: 1, title: ALERT_ISSUE_TITLE, state: "open", pull_request: {} },
      { number: 2, title: "Something else", state: "open" },
      OPEN_ALERT,
    ],
  });
  return findAlertIssues({ token: "t", repo: "o/r", fetchImpl }).then((found) => {
    assert.deepEqual(
      found.map((issue) => issue.number),
      [900],
    );
  });
});

test("findAlertIssues returns [] when the lookup fails", async () => {
  const fetchImpl = async () => jsonResponse(500, { message: "server error" });
  assert.deepEqual(await findAlertIssues({ token: "t", repo: "o/r", fetchImpl }), []);
});

// ── raiseAlert ──────────────────────────────────────────────────────────────

const raiseArgs = {
  token: "t",
  repo: "o/r",
  headline: "Deploy API FAILED",
  failed: ["deploy-staging"],
  headBranch: "main",
  headSha: "4de96af",
  runUrl: "https://example.test/run/1",
};

test("raiseAlert creates the issue when none exists, with the routine-state label", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  const result = await raiseAlert({ ...raiseArgs, fetchImpl });

  assert.deepEqual(result, { action: "created", issueNumber: 901 });
  const create = calls.find((c) => c.method === "POST" && c.path === "/repos/o/r/issues");
  assert.equal(create.body.title, ALERT_ISSUE_TITLE);
  assert.deepEqual(create.body.labels, ALERT_ISSUE_LABELS);
  // routine-state is what keeps /next from claiming this as backlog work.
  assert.ok(create.body.labels.includes("routine-state"));
});

test("raiseAlert comments instead of filing a second issue when one is open", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [OPEN_ALERT] });
  const result = await raiseAlert({ ...raiseArgs, fetchImpl });

  assert.deepEqual(result, { action: "commented", issueNumber: 900 });
  assert.equal(
    calls.filter((c) => c.method === "POST" && c.path === "/repos/o/r/issues").length,
    0,
    "must not create a duplicate alert issue",
  );
  assert.ok(calls.some((c) => c.path === "/repos/o/r/issues/900/comments"));
  // No state PATCH: the issue was already open.
  assert.ok(!calls.some((c) => c.method === "PATCH"));
});

test("raiseAlert reopens a previously resolved alert", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [CLOSED_ALERT] });
  const result = await raiseAlert({ ...raiseArgs, fetchImpl });

  assert.deepEqual(result, { action: "reopened", issueNumber: 900 });
  const patch = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(patch.body, { state: "open" });
  const comment = calls.find((c) => c.path === "/repos/o/r/issues/900/comments");
  assert.match(comment.body.body, /failing again/);
});

test("raiseAlert reports failure rather than throwing when the API rejects the create", async () => {
  const { fetchImpl } = makeFetchStub({ issues: [], failCreate: true });
  const result = await raiseAlert({ ...raiseArgs, fetchImpl });
  assert.deepEqual(result, { action: "failed", issueNumber: null });
});

// ── resolveAlert ────────────────────────────────────────────────────────────

const resolveArgs = {
  token: "t",
  repo: "o/r",
  deployed: ["deploy-staging"],
  headBranch: "main",
  headSha: "4de96af",
  runUrl: "https://example.test/run/2",
};

test("resolveAlert closes the open alert as completed", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [OPEN_ALERT] });
  const result = await resolveAlert({ ...resolveArgs, fetchImpl });

  assert.deepEqual(result, { action: "closed", closed: [900] });
  const patch = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(patch.body, { state: "closed", state_reason: "completed" });
  const comment = calls.find((c) => c.path === "/repos/o/r/issues/900/comments");
  assert.match(comment.body.body, /recovered/i);
});

test("resolveAlert is a no-op when nothing is open", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [CLOSED_ALERT] });
  const result = await resolveAlert({ ...resolveArgs, fetchImpl });

  assert.deepEqual(result, { action: "none", closed: [] });
  assert.ok(!calls.some((c) => c.method === "PATCH" || c.method === "POST"));
});

test("resolveAlert closes every duplicate, so an API-blip duplicate self-heals", async () => {
  const { fetchImpl } = makeFetchStub({
    issues: [OPEN_ALERT, { ...OPEN_ALERT, number: 902 }],
  });
  const result = await resolveAlert({ ...resolveArgs, fetchImpl });
  assert.deepEqual(result.closed, [900, 902]);
});

// ── runDeployAlert (end to end through the real entry path) ─────────────────

test("a failed run writes the summary, annotates as an error, and raises the alert", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  const { logger, lines } = capturingLogger();
  let summary = "";

  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: failedNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger,
  });

  assert.equal(result.outcome, "failed");
  assert.equal(result.alert.action, "created");
  assert.match(summary, /FAILED — nothing deployed/);
  assert.ok(lines.some((line) => line.startsWith("::error::")));
  assert.ok(calls.some((c) => c.method === "POST" && c.path === "/repos/o/r/issues"));
});

test("a successful deploy closes the open alert", async () => {
  const { fetchImpl } = makeFetchStub({ issues: [OPEN_ALERT] });
  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: deployedNeeds(),
    runUrl: "https://example.test/run/2",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
  });

  assert.equal(result.outcome, "deployed");
  assert.deepEqual(result.alert.closed, [900]);
});

test("a no-op run never closes an open alert", async () => {
  // The load-bearing case: skipping every job proves nothing about whether
  // deploys work, so closing here would silence a live outage — and no-op runs
  // are the MAJORITY (46 of the last 90).
  const { fetchImpl, calls } = makeFetchStub({ issues: [OPEN_ALERT] });
  const { logger, lines } = capturingLogger();
  let summary = "";

  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: noOpNeeds(),
    runUrl: "https://example.test/run/3",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger,
  });

  assert.equal(result.outcome, "no-op");
  assert.equal(result.alert.action, "none");
  assert.equal(
    calls.length,
    0,
    "a no-op must not touch the issues API at all — not even to read",
  );
  assert.match(summary, /NO-OP — nothing deployed/);
  assert.ok(lines.some((line) => line.startsWith("::notice::")));
});

test("a no-op run does not annotate as an error", async () => {
  // A green run must stay visually green; the notice carries the information.
  const { fetchImpl } = makeFetchStub({ issues: [] });
  const { logger, lines } = capturingLogger();
  await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: noOpNeeds(),
    runUrl: "https://example.test/run/3",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger,
  });
  assert.ok(!lines.some((line) => line.startsWith("::error::")));
});

test("a total API outage still writes the summary and never throws", async () => {
  // Fail-safe: the reporting half must survive the alerting half being down.
  const fetchImpl = async () => jsonResponse(500, { message: "server error" });
  let summary = "";
  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: failedNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
  });

  assert.equal(result.outcome, "failed");
  assert.equal(result.alert.action, "failed");
  assert.match(summary, /FAILED/);
});

test("a network-level throw is absorbed, not propagated", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNRESET");
  };
  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: failedNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
  });
  assert.equal(result.alert.action, "failed");
});

// ── The Vercel staging configuration (#1674) ────────────────────────────────
// `deploy-alert.mjs` watches two workflows now. These cover the second one and,
// more importantly, the two ways the generalisation could quietly break the
// first: a shared alert title (which would make the two watchdogs close each
// other's issues) and a gate job the second workflow does not have.

/** `toJSON(needs)` for a failed `Deploy Vercel staging` run. */
function vercelFailedNeeds() {
  return { deploy: { result: "failure", outputs: {} } };
}

/** `toJSON(needs)` for a successful one. */
function vercelDeployedNeeds() {
  return { deploy: { result: "success", outputs: {} } };
}

test("resolveAlertConfig resolves both names and refuses everything else", () => {
  assert.equal(resolveAlertConfig("deploy-api"), DEPLOY_API_CONFIG);
  assert.equal(
    resolveAlertConfig("deploy-vercel-staging"),
    DEPLOY_VERCEL_STAGING_CONFIG,
  );

  // A typo'd ALERT_CONFIG must be loud.
  assert.throws(() => resolveAlertConfig("deploy-vercel"), /ALERT_CONFIG/);

  // An ABSENT one must be loud too, and this is the likelier mistake: a third
  // deploy workflow copying a deploy-outcome block and dropping the line.
  // Resolving it to Deploy API would find none of that workflow's job names in
  // `needs`, read them all as "skipped", and report a permanent no-op while
  // looking correctly wired — or, if it owned a job named `deploy-staging`,
  // comment on the live P1 Deploy API alert from an unrelated failure.
  for (const absent of [undefined, null, ""]) {
    assert.throws(() => resolveAlertConfig(absent), /ALERT_CONFIG/, `absent: ${absent}`);
  }

  // The lookup is `Object.hasOwn`, not a truthiness check: a bare object
  // literal inherits these, and each would otherwise slip past the guard and
  // die later without printing the known-configurations list.
  for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
    assert.throws(() => resolveAlertConfig(inherited), /ALERT_CONFIG/, inherited);
  }

  // The error names what is valid, or it is not actionable at 3am.
  assert.throws(() => resolveAlertConfig("nope"), /deploy-api, deploy-vercel-staging/);
});

test("the two configurations never share an alert issue identity", () => {
  // Title is the lookup key. If these two ever matched, a green Vercel deploy
  // would close a live Deploy API outage's alert, and vice versa.
  assert.notEqual(
    DEPLOY_API_CONFIG.alertTitle,
    DEPLOY_VERCEL_STAGING_CONFIG.alertTitle,
  );
  const titles = Object.values(ALERT_CONFIGS).map((config) => config.alertTitle);
  assert.equal(new Set(titles).size, titles.length);
  // Both declare the lookup label. This asserts CONFIG SHAPE, not findability:
  // `lib/alert-issue.mjs` forces `lookupLabel` into the created label set
  // precisely so a caller cannot omit it, and that forcing — not this
  // assertion — is what guarantees an alert can be found again. Do not read
  // this test as making that belt-and-braces redundant.
  for (const config of Object.values(ALERT_CONFIGS)) {
    assert.ok(config.alertLabels.includes("routine-state"), `${config.name} lookup label`);
  }
});

test("a gateless config reports only its deploy jobs", () => {
  assert.equal(DEPLOY_VERCEL_STAGING_CONFIG.gateJob, null);
  assert.deepEqual(alertJobNames(DEPLOY_VERCEL_STAGING_CONFIG), ["deploy"]);
  assert.deepEqual(alertJobNames(DEPLOY_API_CONFIG), [
    "check-changes",
    "migrate-staging",
    "deploy-staging",
  ]);
});

test("a gateless config treats its succeeding deploy job as a deploy, not a gate", () => {
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const jobResults = readJobResults(vercelDeployedNeeds(), config);
  assert.deepEqual(jobResults, { deploy: "success" });

  const { outcome, deployed, failed } = classifyDeployOutcome({ jobResults, config });
  assert.equal(outcome, "deployed");
  assert.deepEqual(deployed, ["deploy"]);
  assert.deepEqual(failed, []);
});

test("a failed Vercel staging run classifies as failed and names the job", () => {
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const jobResults = readJobResults(vercelFailedNeeds(), config);
  const { outcome, failed } = classifyDeployOutcome({ jobResults, config });
  assert.equal(outcome, "failed");
  assert.deepEqual(failed, ["deploy"]);

  const headline = buildHeadline({ outcome, failed, deployed: [], headBranch: "main", config });
  assert.match(headline, /^Deploy Vercel staging FAILED on `main`/);
  // It must not claim to be the other watchdog.
  assert.doesNotMatch(headline, /Deploy API/);
});

test("a cancelled Vercel deploy is a failure, not a benign skip", () => {
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const jobResults = readJobResults({ deploy: { result: "cancelled" } }, config);
  assert.equal(classifyDeployOutcome({ jobResults, config }).outcome, "failed");
});

test("a gateless config's summary renders no changed-path rows", () => {
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const jobResults = readJobResults(vercelFailedNeeds(), config);
  const summary = buildRunSummary({
    outcome: "failed",
    failed: ["deploy"],
    deployed: [],
    jobResults,
    headBranch: "main",
    headSha: "4de96af",
    runUrl: "https://example.test/run/1",
    gateOutputs: {},
    gateSucceeded: false,
    config,
  });

  assert.match(summary, /^## Deploy Vercel staging outcome/);
  assert.match(summary, /\| `deploy` \| failure \|/);
  // The whole point of gateOutputRows being empty: a workflow with no path gate
  // must not print "unknown" for a question it never asks.
  assert.doesNotMatch(summary, /paths changed/);
  assert.doesNotMatch(summary, /check-changes/);
});

test("the Vercel alert issue body names its own workflow and issue numbers", () => {
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const body = buildAlertIssueBody({
    headline: "Deploy Vercel staging FAILED on `main` — deploy did not succeed.",
    failed: ["deploy"],
    headBranch: "main",
    headSha: "4de96af",
    runUrl: "https://example.test/run/1",
    config,
  });

  assert.match(body, /## Deploy Vercel staging is failing/);
  assert.match(body, /\.github\/workflows\/deploy-vercel-staging\.yml/);
  assert.match(body, /ADR-21/);
  assert.match(body, /#1578/);
  // Must not inherit the Deploy API alert's prose or its workflow file.
  assert.doesNotMatch(body, /deploy-api\.yml/);
  assert.doesNotMatch(body, /#763/);
  // Still tells a reader not to claim it as backlog work.
  assert.match(body, /routine-state/);
});

test("runDeployAlert files the Vercel alert under the Vercel title", async () => {
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  let summary = "";

  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: vercelFailedNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
    config,
  });

  assert.equal(result.outcome, "failed");
  assert.equal(result.alert.action, "created");

  const created = calls.find((call) => call.method === "POST" && call.path === "/repos/o/r/issues");
  assert.equal(created.body.title, DEPLOY_VERCEL_STAGING_CONFIG.alertTitle);
  assert.notEqual(created.body.title, ALERT_ISSUE_TITLE);
  assert.ok(created.body.labels.includes("routine-state"));
  assert.ok(created.body.labels.includes("P2"));
  assert.match(summary, /Deploy Vercel staging/);

  // The BODY too, not just the title. `raiseAlert` passes `config.alertTitle`
  // to the library directly but builds the body through a closure, so those two
  // can disagree: dropping `config` from the closure yields an issue titled
  // "Deploy Vercel staging is failing…" whose body opens "## Deploy API is
  // failing" and points at deploy-api.yml. Asserting the title alone did not
  // catch that.
  assert.match(created.body.body, /## Deploy Vercel staging is failing/);
  assert.match(created.body.body, /deploy-vercel-staging\.yml/);
  assert.doesNotMatch(created.body.body, /deploy-api\.yml/);
});

test("a recovered Vercel deploy closes only the Vercel alert", async () => {
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const openVercelAlert = {
    number: 950,
    state: "open",
    title: DEPLOY_VERCEL_STAGING_CONFIG.alertTitle,
  };
  const openApiAlert = { number: 951, state: "open", title: ALERT_ISSUE_TITLE };
  const { fetchImpl, calls } = makeFetchStub({
    issues: [openVercelAlert, openApiAlert],
  });

  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: vercelDeployedNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config,
  });

  assert.equal(result.outcome, "deployed");
  assert.deepEqual(result.alert.closed, [950]);
  // The Deploy API alert must be untouched — this is the cross-watchdog
  // regression the shared title check above exists to prevent.
  const patched = calls.filter((call) => call.method === "PATCH").map((call) => call.path);
  assert.deepEqual(patched, ["/repos/o/r/issues/950"]);
});

test("a gateless config escalates 'nothing ran' to a failure, not a benign no-op", async () => {
  // The regression: `needs: [deploy]` does not stop an always() job when its
  // dependency is skipped. If the two `if:` blocks ever drift, every merge
  // deploys nothing to staging while the run stays green — and the only signal
  // would be an annotation on a `workflow_run` page, which lands on no commit
  // and no PR. That is the ADR-21 frozen-staging failure verbatim, so it has to
  // raise a real alert.
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const jobResults = readJobResults({ deploy: { result: "skipped" } }, config);
  const { outcome, failed } = classifyDeployOutcome({ jobResults, config });

  assert.equal(outcome, "failed");
  assert.deepEqual(failed, ["deploy"]);

  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: { deploy: { result: "skipped" } },
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config,
  });
  assert.equal(result.alert.action, "created");
  const created = calls.find((c) => c.method === "POST" && c.path === "/repos/o/r/issues");
  assert.equal(created.body.title, DEPLOY_VERCEL_STAGING_CONFIG.alertTitle);
});

test("the gated config keeps a no-op benign, and never closes an open alert", async () => {
  // The other half of the same switch. 46 of the 90 runs in #763 were
  // green-because-empty; treating those as failures would have alerted on every
  // docs-only push, and treating them as recoveries would have closed a live
  // outage's alert. Both directions must stay wrong-proof.
  assert.equal(DEPLOY_API_CONFIG.noOpIsUnexpected, false);
  const { outcome } = classifyDeployOutcome({ jobResults: readJobResults(noOpNeeds()) });
  assert.equal(outcome, "no-op");

  const { fetchImpl, calls } = makeFetchStub({ issues: [OPEN_ALERT] });
  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: noOpNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
  });
  assert.equal(result.alert.action, "none");
  assert.deepEqual(
    calls.filter((c) => c.method !== "GET"),
    [],
    "a no-op must write nothing at all",
  );
});

test("a SECOND Vercel failure comments as Vercel, not as Deploy API", async () => {
  // The gap this closes: `config` is threaded into raiseAlert's buildCommentBody
  // closure, and every other test here stubs `issues: []` — which only ever
  // reaches the CREATE path. Deleting `config` from that closure left all tests
  // green while, in production, the second and every later Vercel failure would
  // comment "**Deploy API failed again.**" onto the Vercel alert issue: the
  // wrong watchdog named in the wrong incident thread.
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const openVercelAlert = { number: 950, state: "open", title: config.alertTitle };
  const { fetchImpl, calls } = makeFetchStub({ issues: [openVercelAlert] });

  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: vercelFailedNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config,
  });

  assert.equal(result.alert.action, "commented");
  const comment = calls.find(
    (c) => c.method === "POST" && c.path === "/repos/o/r/issues/950/comments",
  );
  assert.match(comment.body.body, /\*\*Deploy Vercel staging failed again\.\*\*/);
  assert.doesNotMatch(comment.body.body, /Deploy API/);
});

test("a reopened Vercel alert names Vercel in its reopen comment", async () => {
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const closedVercelAlert = { number: 950, state: "closed", title: config.alertTitle };
  const { fetchImpl, calls } = makeFetchStub({ issues: [closedVercelAlert] });

  const result = await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: vercelFailedNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config,
  });

  assert.equal(result.alert.action, "reopened");
  const comment = calls.find(
    (c) => c.method === "POST" && c.path === "/repos/o/r/issues/950/comments",
  );
  assert.match(comment.body.body, /\*\*Deploy Vercel staging is failing again\*\* — reopening\./);
  assert.doesNotMatch(comment.body.body, /Deploy API/);
});

test("the Vercel recovery comment names Vercel, not Deploy API", async () => {
  // Same hole on the resolve path: `a recovered Vercel deploy closes only the
  // Vercel alert` asserts which issue was PATCHed but never reads the comment,
  // so dropping `config` from buildRecoveryBody was invisible.
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const openVercelAlert = { number: 950, state: "open", title: config.alertTitle };
  const { fetchImpl, calls } = makeFetchStub({ issues: [openVercelAlert] });

  await runDeployAlert({
    token: "t",
    repo: "o/r",
    needs: vercelDeployedNeeds(),
    runUrl: "https://example.test/run/1",
    headBranch: "main",
    headSha: "4de96af",
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config,
  });

  const comment = calls.find(
    (c) => c.method === "POST" && c.path === "/repos/o/r/issues/950/comments",
  );
  assert.match(comment.body.body, /\*\*Deploy Vercel staging recovered\.\*\* Closing\./);
  assert.doesNotMatch(comment.body.body, /Deploy API/);
});

// ── Every caller names itself ───────────────────────────────────────────────

test("every workflow running deploy-alert.mjs sets a known ALERT_CONFIG", () => {
  // `main()` calls requireEnv("ALERT_CONFIG"), so a workflow that omits it
  // fails at deploy time — loud, but only once a deploy actually runs. This
  // catches it in CI instead, and covers workflows added later: it discovers
  // callers by scanning, rather than listing the two that exist today.
  const workflowDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    ".github",
    "workflows",
  );

  // `.yaml` as well as `.yml`. Actions honours both, and scanning only one is
  // the exact hole this test exists to close — a `deploy-mobile.yaml` with a
  // copied deploy-outcome block would never be read, and the roster assertion
  // below could not compensate because it is built from the same list.
  const callers = readdirSync(workflowDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => ({ name, text: readFileSync(join(workflowDir, name), "utf8") }))
    .filter(({ text }) =>
      text.split("\n").some((line) => !/^\s*#/.test(line) && line.includes("deploy-alert.mjs")),
    );

  // Guards the scan itself: a path typo would make the loop below vacuous.
  assert.deepEqual(
    callers.map((c) => c.name).sort(),
    ["deploy-api.yml", "deploy-vercel-staging.yml"],
    "expected exactly the two known callers — add the new one to this list deliberately",
  );

  // Tolerates the forms a human will actually write: quoted or bare, with or
  // without a trailing comment. A guard that fails on `ALERT_CONFIG: "deploy-api"`
  // trains people to distrust it. `matchAll`, not `match`, so a workflow with
  // two reporting steps has BOTH checked rather than only the first.
  const configsIn = (text) =>
    [
      ...text.matchAll(
        /^[ \t]*ALERT_CONFIG:[ \t]*["']?([A-Za-z0-9._-]+)["']?[ \t]*(?:#.*)?$/gm,
      ),
    ].map((m) => m[1]);

  const claimedBy = new Map();
  for (const { name, text } of callers) {
    const configs = configsIn(text);
    assert.ok(configs.length > 0, `${name} runs deploy-alert.mjs but sets no ALERT_CONFIG`);
    for (const config of configs) {
      assert.ok(
        Object.hasOwn(ALERT_CONFIGS, config),
        `${name} sets ALERT_CONFIG: ${config}, which is not a known configuration`,
      );
      claimedBy.set(config, (claimedBy.get(config) ?? new Set()).add(name));
    }
  }

  // No configuration may be claimed by two different workflows — that would
  // point both at one alert issue, so either could close the other's incident.
  for (const [config, files] of claimedBy) {
    assert.equal(
      files.size,
      1,
      `ALERT_CONFIG ${config} is claimed by ${[...files].join(" and ")}`,
    );
  }
});

test("an escalated no-op explains its own job table instead of contradicting it", () => {
  // Escalation puts a job whose result is `skipped` into `failed`. Reported
  // with the ordinary failure copy that renders as a contradiction the reader
  // cannot resolve — a red "FAILED" badge and "deploy did not succeed" above a
  // table saying `deploy | skipped` — which sends them hunting for a failed
  // build that does not exist.
  const config = DEPLOY_VERCEL_STAGING_CONFIG;
  const jobResults = readJobResults({ deploy: { result: "skipped" } }, config);
  const { outcome, failed, deployed, escalated } = classifyDeployOutcome({ jobResults, config });
  assert.equal(escalated, true);

  const headline = buildHeadline({ outcome, failed, deployed, headBranch: "main", escalated, config });
  assert.match(headline, /did not run at all/);
  assert.doesNotMatch(headline, /did not succeed/);

  const summary = buildRunSummary({
    outcome,
    failed,
    deployed,
    jobResults,
    headBranch: "main",
    headSha: "abc1234",
    runUrl: "https://example.test/run/1",
    gateOutputs: {},
    gateSucceeded: false,
    escalated,
    config,
  });
  assert.match(summary, /NOTHING RAN/);
  // The note is what reconciles the red badge with the `skipped` row.
  assert.match(summary, /those two have drifted apart/);
});

test("escalation leaves the gated config's classify shape untouched", () => {
  // `escalated` is spread in only when true, so a Deploy API run returns
  // exactly the three keys it always did. A differential harness compares these
  // objects; an unconditional key would break that parity for no benefit.
  const result = classifyDeployOutcome({ jobResults: readJobResults(noOpNeeds()) });
  assert.deepEqual(Object.keys(result).sort(), ["deployed", "failed", "outcome"]);
  assert.equal(result.outcome, "no-op");
});
