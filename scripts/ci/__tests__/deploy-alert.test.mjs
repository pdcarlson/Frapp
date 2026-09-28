import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ALERT_CONFIGS,
  DEPLOY_PRODUCTION_CONFIG,
  DEPLOY_STAGING_CONFIG,
  alertJobNames,
  approvalRejected,
  buildAlertCommentBody,
  buildAlertIssueBody,
  buildHeadline,
  buildRunSummary,
  classifyDeployOutcome,
  findAlertIssues,
  isSuperseded,
  raiseAlert,
  readJobResults,
  readPlan,
  resolveAlert,
  resolveAlertConfig,
  runDeployAlert,
} from "../deploy-alert.mjs";
import { ALERT_ASSIGNEE, ALERT_LOOKUP_LABEL } from "../lib/alert-issue.mjs";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Two kinds of config are used here, and they must not be confused.
//
// * The REAL one, `DEPLOY_STAGING_CONFIG` (`deploy-staging.yml`, #2803): one
//   gateless `deploy` job that publishes a `plan` output. It is also
//   `DEFAULT_ALERT_CONFIG`, so a test that passes it explicitly cannot tell
//   whether `config` was threaded through or the default was used instead.
// * STAND-INS, defined only in this file. They exercise machinery
//   `deploy-alert.mjs` still supports with no live user (a gate job, gate
//   output rows, several deploy jobs, a plan on one of several jobs, a benign
//   no-op), because production's alert (#2805) is the next config and may use
//   any of it. Being the only NON-default configs, they are also what proves
//   each function reads the config it is handed.

/**
 * STAND-IN, not a live config. The shape of the retired `deploy-api` config
 * (`deploy-api.yml`, deleted by #2803): a `check-changes` gate, then
 * `migrate-staging` and `deploy-staging`, with the plan on `deploy-staging`.
 *
 * Its title is deliberately NOT one of `DEPLOY_STAGING_CONFIG`'s retired
 * titles, so it can stand for "another watchdog's live alert" in the isolation
 * tests. It declares no `retiredAlertTitles` on purpose: a config without one
 * must still resolve.
 */
const API_SHAPED_CONFIG = {
  name: "api-shaped-stand-in",
  workflowLabel: "API-shaped stand-in",
  workflowFile: ".github/workflows/api-shaped-stand-in.yml",
  gateJob: "check-changes",
  deployJobs: ["migrate-staging", "deploy-staging"],
  gateOutputRows: [],
  planOutput: { job: "deploy-staging", output: "plan" },
  closesOn: "a later stand-in run for `main`'s tip deploys successfully",
  alertTitle: "API-shaped stand-in is failing — test fixture only",
  alertLabels: [ALERT_LOOKUP_LABEL, "area:ci", "P3"],
  noOpReason: "no migrate or deploy job ran",
  noOpIsUnexpected: true,
  noOpNote: "Neither `migrate-staging` nor `deploy-staging` ran. (Stand-in note.)",
  whyLines: ["Stand-in why-line: this config exists only in deploy-alert.test.mjs."],
};

/**
 * STAND-IN, not a live config. A path-gated config whose no-op is benign: the
 * retired Deploy API shape before #2505, when `check-changes` skipped the
 * deploy jobs on docs-only pushes. No config has been shaped like this since,
 * but `noOpIsUnexpected: false` and `gateOutputRows` are still supported. It
 * declares no `planOutput` and no `closesOn`, so it also covers both defaults.
 */
const GATED_CONFIG = {
  ...API_SHAPED_CONFIG,
  name: "gated-stand-in",
  workflowLabel: "Gated stand-in",
  workflowFile: ".github/workflows/gated-stand-in.yml",
  alertTitle: "Gated stand-in is failing — test fixture only",
  noOpIsUnexpected: false,
  noOpReason: "the changed-path gate skipped every migrate and deploy job",
  noOpNote: "The changed-path gate found nothing to deploy. See issue #763.",
  gateOutputRows: [{ label: "API paths changed", output: "api-changed" }],
  planOutput: undefined,
  closesOn: undefined,
};

/**
 * `toJSON(needs)` for a `Deploy staging` run: its one `deploy` job, and the
 * plan that job published (omit `plan` for a job that published none).
 */
function stagingNeeds(result, plan) {
  return { deploy: { result, outputs: plan === undefined ? {} : { plan } } };
}

/** `toJSON(needs)` for deploy-production.yml's `deploy-outcome` job (#2805). */
function productionNeeds(result) {
  return {
    validate: { result: "success", outputs: { sha: "4de96af" } },
    deploy: { result, outputs: { started: "true" } },
    release: { result: result === "success" ? "success" : "skipped", outputs: {} },
  };
}

// `toJSON(needs)` for the stand-ins, in the retired deploy-api shape, modeled
// on the two real shapes measured in #763 over 90 runs on main:
//   * 44 runs where check-changes said api-changed=true and the deploy job then
//     failed at the Infisical injection step (run 31278413630);
//   * 46 runs where every deploy/migrate job skipped and the run reported green
//     (run 31278674931), the "green because empty" case.

/** The path gate skipped everything. */
function apiShapedNoOpNeeds() {
  return {
    "check-changes": {
      result: "success",
      outputs: { "api-changed": "false", "migrations-changed": "false" },
    },
    "migrate-staging": { result: "skipped", outputs: {} },
    "deploy-staging": { result: "skipped", outputs: {} },
  };
}

/** Run 31278413630's shape: api changed, the deploy failed, migrate skipped. */
function apiShapedFailedNeeds() {
  return {
    "check-changes": {
      result: "success",
      outputs: { "api-changed": "true", "migrations-changed": "false" },
    },
    "migrate-staging": { result: "skipped", outputs: {} },
    "deploy-staging": { result: "failure", outputs: {} },
  };
}

/** Both jobs succeeded, the deploy job having planned `plan`. */
function apiShapedDeployedNeeds(plan = "deploy") {
  return {
    "check-changes": {
      result: "success",
      outputs: { "api-changed": "true", "migrations-changed": "true" },
    },
    "migrate-staging": { result: "success", outputs: {} },
    "deploy-staging": { result: "success", outputs: { plan } },
  };
}

// The titles of the two alerts `DEPLOY_STAGING_CONFIG` replaced (#2803).
// Literal, not read from the config, so the retired-title tests do not follow
// an edit to the list they are checking.
const RETIRED_API_TITLE = "Deploy API is failing — pushes are not reaching the environment";
const RETIRED_VERCEL_TITLE =
  "Deploy Vercel staging is failing — web and landing are not reaching staging";

/** An issue as the issues API lists it. */
function alertIssue(number, title, state = "open") {
  return { number, title, state };
}

const OPEN_ALERT = alertIssue(900, DEPLOY_STAGING_CONFIG.alertTitle);
const CLOSED_ALERT = alertIssue(900, DEPLOY_STAGING_CONFIG.alertTitle, "closed");

/**
 * Minimal GitHub API stub. Every issues lookup answers with `issues` (the
 * library filters them by exact title). `failGets` lists which lookups, by
 * 1-based call order, answer 502; `failCloseFor` lists issue numbers whose
 * PATCH is refused. Records every call for assertions.
 */
function makeFetchStub({ issues = [], failCreate = false, failGets = [], failCloseFor = [] } = {}) {
  const calls = [];
  let gets = 0;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? "GET";
    const path = url.replace("https://api.github.com", "");
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path, body });

    if (method === "GET" && path.startsWith("/repos/o/r/issues?")) {
      gets += 1;
      if (failGets.includes(gets)) return jsonResponse(502, { message: "bad gateway" });
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
      const number = Number(path.split("/").pop());
      if (failCloseFor.includes(number)) return jsonResponse(500, { message: "boom" });
      return jsonResponse(200, { number });
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

/** classifyDeployOutcome over a `needs` context, read the way runDeployAlert reads it. */
function classify(needs, config = DEPLOY_STAGING_CONFIG) {
  return classifyDeployOutcome({ jobResults: readJobResults(needs, config), config });
}

/** The arguments every runDeployAlert call below shares. */
const RUN = {
  token: "t",
  repo: "o/r",
  runUrl: "https://example.test/run/1",
  headBranch: "main",
  headSha: "4de96af",
};

// ── Alert issue identity ────────────────────────────────────────────────────

test("the staging alert's title and priority are pinned, and the titles it replaced stay closable", () => {
  // Titles are LOOKUP KEYS: an alert issue is found by exact title, so
  // renaming one orphans whatever alert is open under the old string. It can
  // never be found again, and so never self-closes. #2803 merged Deploy API
  // and Deploy Vercel staging into this one config, which renamed both. Their
  // old titles stay listed so a successful run still closes an issue left open
  // under either; dropping or editing one strands that issue for good.
  assert.equal(
    DEPLOY_STAGING_CONFIG.alertTitle,
    "Deploy staging is failing — merges are not reaching staging",
  );
  assert.deepEqual(DEPLOY_STAGING_CONFIG.retiredAlertTitles, [
    "Deploy API is failing — pushes are not reaching the environment",
    "Deploy Vercel staging is failing — web and landing are not reaching staging",
  ]);
  // P1, the level Deploy API used (owner decision on #2803): the frontends
  // ship only behind a verified API, so a failure anywhere stops staging.
  assert.deepEqual(DEPLOY_STAGING_CONFIG.alertLabels, [ALERT_LOOKUP_LABEL, "area:ci", "P1"]);
});

// ── readJobResults ──────────────────────────────────────────────────────────

test("readJobResults flattens the needs context", () => {
  assert.deepEqual(readJobResults(stagingNeeds("failure", "deploy")), { deploy: "failure" });
  // A gated multi-job config reads its gate as well as every deploy job.
  assert.deepEqual(readJobResults(apiShapedFailedNeeds(), API_SHAPED_CONFIG), {
    "check-changes": "success",
    "migrate-staging": "skipped",
    "deploy-staging": "failure",
  });
});

test("readJobResults reads a missing job as skipped rather than throwing", () => {
  // A job renamed or removed in a watched workflow must degrade to a reported
  // no-op (escalated, for a gateless config), not a crash.
  assert.deepEqual(readJobResults({}), { deploy: "skipped" });
  const results = readJobResults({ "check-changes": { result: "success" } }, API_SHAPED_CONFIG);
  assert.equal(results["deploy-staging"], "skipped");
  assert.doesNotThrow(() => readJobResults(undefined));
  assert.doesNotThrow(() => readJobResults(undefined, API_SHAPED_CONFIG));
});

// ── classifyDeployOutcome ───────────────────────────────────────────────────
// The gate and multi-job cases run on the stand-ins: the real config has one
// job and no gate. Its own cases are in the Deploy staging section below.

test("a failed deploy job classifies as failed, naming only that job", () => {
  const result = classify(apiShapedFailedNeeds(), API_SHAPED_CONFIG);
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.failed, ["deploy-staging"]);
});

test("all-skipped classifies as no-op, not as a deploy", () => {
  const result = classify(apiShapedNoOpNeeds(), GATED_CONFIG);
  assert.equal(result.outcome, "no-op");
  assert.deepEqual(result.deployed, []);
});

test("a gated config that expects its jobs to run escalates an all-skipped run to a failure", () => {
  // The retired Deploy API config's shape after #2505: its gate still ran, but
  // both jobs ran on every eligible push, so a run where neither did meant their
  // conditions had drifted. A succeeding gate must not hide that.
  const result = classify(apiShapedNoOpNeeds(), API_SHAPED_CONFIG);
  assert.equal(result.outcome, "failed");
  assert.equal(result.escalated, true);
  assert.deepEqual(result.failed, ["migrate-staging", "deploy-staging"]);
});

test("the gate job succeeding is not itself a deploy", () => {
  // The regression this guards: counting the gate as a deployed job would make
  // every green-because-empty run look like a successful deploy.
  for (const config of [API_SHAPED_CONFIG, GATED_CONFIG]) {
    const result = classify(apiShapedNoOpNeeds(), config);
    assert.ok(!result.deployed.includes("check-changes"), config.name);
    assert.notEqual(result.outcome, "deployed", config.name);
  }
});

test("successful migrate + deploy classifies as deployed", () => {
  const result = classify(apiShapedDeployedNeeds(), API_SHAPED_CONFIG);
  assert.equal(result.outcome, "deployed");
  assert.deepEqual(result.deployed, ["migrate-staging", "deploy-staging"]);
});

test("a failed gate job classifies as failed even though nothing deployed", () => {
  const needs = apiShapedNoOpNeeds();
  needs["check-changes"].result = "failure";
  const result = classify(needs, API_SHAPED_CONFIG);
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.failed, ["check-changes"]);
});

test("cancelled and timed_out count as failures, not as benign", () => {
  for (const badResult of ["cancelled", "timed_out"]) {
    const needs = apiShapedFailedNeeds();
    needs["deploy-staging"].result = badResult;
    assert.equal(classify(needs, API_SHAPED_CONFIG).outcome, "failed", `${badResult} should alert`);
    assert.equal(classify(stagingNeeds(badResult, "deploy")).outcome, "failed", `staging ${badResult}`);
  }
});

test("failure wins over a sibling success", () => {
  const needs = apiShapedDeployedNeeds();
  needs["deploy-staging"].result = "failure";
  const result = classify(needs, API_SHAPED_CONFIG);
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
    config: GATED_CONFIG,
  });
  assert.match(headline, /deployed NOTHING/);
  assert.match(headline, /green because it declined to deploy/);
});

test("the run summary distinguishes a no-op from a deploy at a glance", () => {
  const summary = buildRunSummary({
    outcome: "no-op",
    failed: [],
    deployed: [],
    jobResults: readJobResults(apiShapedNoOpNeeds(), GATED_CONFIG),
    headBranch: "main",
    headSha: "4de96af",
    runUrl: "https://example.test/run/1",
    gateOutputs: { "api-changed": false, "migrations-changed": false },
    gateSucceeded: true,
    config: GATED_CONFIG,
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
    jobResults: readJobResults(apiShapedFailedNeeds(), API_SHAPED_CONFIG),
    headBranch: "main",
    headSha: "4de96af",
    runUrl: "https://example.test/run/1",
    gateOutputs: { "api-changed": true, "migrations-changed": false },
    gateSucceeded: true,
    config: API_SHAPED_CONFIG,
  });
  assert.match(summary, /FAILED — not confirmed deployed/);
  assert.match(summary, /\| `deploy-staging` \| failure \|/);
  assert.match(summary, /4de96af/);
});

test("a failed gate reports the path flags as unknown, never as 'no'", async () => {
  // The gate's outputs are empty when it fails, which is NOT the same as "no
  // paths changed" — rendering the absent output as `no` states an unmeasured
  // value as fact.
  const needs = apiShapedNoOpNeeds();
  needs["check-changes"].result = "failure";
  needs["check-changes"].outputs = {};

  let summary = "";
  await runDeployAlert({
    ...RUN,
    needs,
    fetchImpl: makeFetchStub({ issues: [] }).fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
    config: GATED_CONFIG,
  });

  assert.match(summary, /\| API paths changed \| unknown \|/);
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

test("findAlertIssues ignores pull requests and foreign titles, retired ones included", async () => {
  // A retired title is foreign to the lookup: only resolveAlert reads those,
  // to close them. raiseAlert, which uses this lookup, must never comment on
  // or reopen an issue that watched a workflow that no longer exists.
  const { fetchImpl } = makeFetchStub({
    issues: [
      { number: 1, title: DEPLOY_STAGING_CONFIG.alertTitle, state: "open", pull_request: {} },
      { number: 2, title: "Something else", state: "open" },
      alertIssue(3, RETIRED_API_TITLE),
      OPEN_ALERT,
    ],
  });
  const found = await findAlertIssues({ token: "t", repo: "o/r", fetchImpl });
  assert.deepEqual(
    found.map((issue) => issue.number),
    [900],
  );
});

test("findAlertIssues returns [] when the lookup fails", async () => {
  const fetchImpl = async () => jsonResponse(500, { message: "server error" });
  assert.deepEqual(await findAlertIssues({ token: "t", repo: "o/r", fetchImpl }), []);
});

// ── raiseAlert ──────────────────────────────────────────────────────────────

const raiseArgs = {
  token: "t",
  repo: "o/r",
  headline: "Deploy staging FAILED",
  failed: ["deploy"],
  headBranch: "main",
  headSha: "4de96af",
  runUrl: "https://example.test/run/1",
};

test("raiseAlert creates the issue when none exists, with the incident label and the owner assigned", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  const result = await raiseAlert({ ...raiseArgs, fetchImpl });

  assert.deepEqual(result, { action: "created", issueNumber: 901 });
  const create = calls.find((c) => c.method === "POST" && c.path === "/repos/o/r/issues");
  assert.equal(create.body.title, DEPLOY_STAGING_CONFIG.alertTitle);
  assert.deepEqual(create.body.labels, DEPLOY_STAGING_CONFIG.alertLabels);
  // The lookup label is what keeps /next from claiming this as backlog work.
  assert.ok(create.body.labels.includes(ALERT_LOOKUP_LABEL));
  assert.deepEqual(create.body.assignees, [ALERT_ASSIGNEE]);
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
  assert.deepEqual(patch.body, { state: "open", assignees: [ALERT_ASSIGNEE] });
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
  deployed: ["deploy"],
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
  // Its own alert recovered; only a retired one is "replaced".
  assert.doesNotMatch(comment.body.body, /Replaced by/);
});

test("resolveAlert is a no-op when nothing is open", async () => {
  // A closed issue under a retired title is left alone too.
  const { fetchImpl, calls } = makeFetchStub({
    issues: [CLOSED_ALERT, alertIssue(960, RETIRED_API_TITLE, "closed")],
  });
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

// ── Retired alert titles (#2803) ────────────────────────────────────────────
// Deploy staging replaced Deploy API and Deploy Vercel staging, and their
// alerts' titles went with them. An issue still open under either would never
// be looked up again, so a successful Deploy staging run closes it as
// replaced. Only a successful run: a failure raises Deploy staging's own alert.

test("a successful run closes an issue still open under a retired title, as replaced rather than recovered", async () => {
  for (const [number, title] of [
    [960, RETIRED_API_TITLE],
    [961, RETIRED_VERCEL_TITLE],
  ]) {
    const { fetchImpl, calls } = makeFetchStub({ issues: [alertIssue(number, title)] });
    const result = await runDeployAlert({
      ...RUN,
      needs: stagingNeeds("success", "deploy"),
      fetchImpl,
      writeSummary: () => {},
      logger: silentLogger,
      config: DEPLOY_STAGING_CONFIG,
    });

    assert.equal(result.outcome, "deployed");
    // Its own title found nothing ("none"); the retired one closed, and
    // "closed" outranks "none".
    assert.deepEqual(result.alert, { action: "closed", closed: [number] }, title);
    const patches = calls.filter((c) => c.method === "PATCH");
    assert.deepEqual(
      patches.map((c) => c.path),
      [`/repos/o/r/issues/${number}`],
    );
    assert.deepEqual(patches[0].body, { state: "closed", state_reason: "completed" });

    const comment = calls.find((c) => c.path === `/repos/o/r/issues/${number}/comments`).body.body;
    // "Recovered" would claim the retired workflow came back. It no longer
    // exists; the comment says what replaced it, and where its alert now lives.
    assert.match(comment, /^\*\*Replaced by Deploy staging, which succeeded\.\*\* Closing\./);
    assert.doesNotMatch(comment, /recovered/i);
    assert.ok(comment.includes("`.github/workflows/deploy-staging.yml`"), title);
    assert.ok(comment.includes(DEPLOY_STAGING_CONFIG.alertTitle), title);
  }
});

test("one run closes its own alert and every retired one together", async () => {
  const { fetchImpl, calls } = makeFetchStub({
    issues: [
      OPEN_ALERT,
      alertIssue(960, RETIRED_API_TITLE),
      alertIssue(961, RETIRED_VERCEL_TITLE),
    ],
  });
  const result = await resolveAlert({ ...resolveArgs, fetchImpl });

  assert.deepEqual(result, { action: "closed", closed: [900, 960, 961] });
  const commentOn = (number) =>
    calls.find((c) => c.path === `/repos/o/r/issues/${number}/comments`).body.body;
  assert.match(commentOn(900), /^\*\*Deploy staging recovered\.\*\* Closing\./);
  assert.doesNotMatch(commentOn(900), /Replaced by/);
  for (const number of [960, 961]) {
    assert.match(commentOn(number), /^\*\*Replaced by Deploy staging, which succeeded\.\*\*/);
  }
});

test("a retired title that could not be read makes the run unread, even though its own alert closed", async () => {
  // Titles are looked up in order: its own, then each retired one. The second
  // lookup failing means an old alert may still be open, so the run must not
  // log a clean closure. What did close is still reported.
  const { fetchImpl } = makeFetchStub({
    issues: [OPEN_ALERT, alertIssue(961, RETIRED_VERCEL_TITLE)],
    failGets: [2],
  });
  const { logger, lines } = capturingLogger();
  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("success", "deploy"),
    fetchImpl,
    writeSummary: () => {},
    logger,
    config: DEPLOY_STAGING_CONFIG,
  });

  assert.deepEqual(result.alert, { action: "unread", closed: [900, 961] });
  // One warning that names what closed and what could not be read: never
  // "none was closed" when two issues did.
  const warning = lines.find((line) => /::warning::/.test(line));
  assert.match(warning, /closed alert issue\(s\) 900, 961/);
  assert.match(warning, /could not be read/);
  assert.doesNotMatch(warning, /none was closed/);
});

test("a retired alert that would not close makes the run failed, and failed outranks unread", async () => {
  // A failed close is an alert known to be open, which is worse than one that
  // could not be read.
  const first = makeFetchStub({
    issues: [OPEN_ALERT, alertIssue(960, RETIRED_API_TITLE)],
    failCloseFor: [960],
  });
  assert.deepEqual(await resolveAlert({ ...resolveArgs, fetchImpl: first.fetchImpl }), {
    action: "failed",
    closed: [900],
  });

  // The retired Deploy API lookup fails (unread) and the retired Vercel close
  // fails (failed): the run is failed.
  const second = makeFetchStub({
    issues: [OPEN_ALERT, alertIssue(961, RETIRED_VERCEL_TITLE)],
    failGets: [2],
    failCloseFor: [961],
  });
  assert.deepEqual(await resolveAlert({ ...resolveArgs, fetchImpl: second.fetchImpl }), {
    action: "failed",
    closed: [900],
  });

  // The run log names the issue that did close, beside the failed-close warning.
  const third = makeFetchStub({
    issues: [OPEN_ALERT, alertIssue(960, RETIRED_API_TITLE)],
    failCloseFor: [960],
  });
  const { logger, lines } = capturingLogger();
  await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("success", "deploy"),
    fetchImpl: third.fetchImpl,
    writeSummary: () => {},
    logger,
    config: DEPLOY_STAGING_CONFIG,
  });
  assert.ok(lines.some((line) => /closed alert issue\(s\): 900$/.test(line)), lines.join("\n"));
  assert.ok(lines.some((line) => /::warning::.*could not be closed/.test(line)));
});

test("a failed run never touches a retired-title issue", async () => {
  // Raising looks up only the live title. An issue under a retired one, open
  // or closed, watched a workflow that no longer exists: commenting on it or
  // reopening it would page the owner about a deleted workflow. A failure
  // files Deploy staging's own alert instead, whether the deploy failed or
  // never ran.
  for (const needs of [stagingNeeds("failure", "deploy"), stagingNeeds("skipped")]) {
    const { fetchImpl, calls } = makeFetchStub({
      issues: [alertIssue(960, RETIRED_API_TITLE), alertIssue(961, RETIRED_VERCEL_TITLE, "closed")],
    });
    const result = await runDeployAlert({
      ...RUN,
      needs,
      fetchImpl,
      writeSummary: () => {},
      logger: silentLogger,
      config: DEPLOY_STAGING_CONFIG,
    });

    assert.equal(result.outcome, "failed");
    assert.deepEqual(result.alert, { action: "created", issueNumber: 901 });
    const create = calls.find((c) => c.method === "POST" && c.path === "/repos/o/r/issues");
    assert.equal(create.body.title, DEPLOY_STAGING_CONFIG.alertTitle);
    assert.ok(
      !calls.some((c) => /\/issues\/96[01](\/|$)/.test(c.path)),
      "no call may touch a retired-title issue",
    );
  }
});

// ── runDeployAlert (end to end through the real entry path) ─────────────────

test("a failed run writes the summary, annotates as an error, and raises the alert", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  const { logger, lines } = capturingLogger();
  let summary = "";

  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("failure", "deploy"),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger,
  });

  assert.equal(result.outcome, "failed");
  assert.equal(result.alert.action, "created");
  assert.match(summary, /FAILED — not confirmed deployed/);
  assert.ok(lines.some((line) => line.startsWith("::error::")));
  assert.ok(calls.some((c) => c.method === "POST" && c.path === "/repos/o/r/issues"));
});

test("a successful deploy closes the open alert", async () => {
  const { fetchImpl } = makeFetchStub({ issues: [OPEN_ALERT] });
  const result = await runDeployAlert({
    ...RUN,
    runUrl: "https://example.test/run/2",
    needs: stagingNeeds("success", "deploy"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
  });

  assert.equal(result.outcome, "deployed");
  assert.deepEqual(result.alert.closed, [900]);
});

test("a successful deploy whose alert lookup fails reports unread, never 'still open'", async () => {
  // A 502 on the lookup means this run cannot know whether an alert is open.
  // Before #2627 it read as "none" (silently fine); a lib-only change briefly
  // made it "failed", which warned that the alert "is still open" after an
  // ordinary successful deploy.
  const fetchImpl = async () => jsonResponse(502, { message: "bad gateway" });
  const { logger, lines } = capturingLogger();
  const result = await runDeployAlert({
    ...RUN,
    runUrl: "https://example.test/run/2",
    needs: stagingNeeds("success", "deploy"),
    fetchImpl,
    writeSummary: () => {},
    logger,
  });

  assert.equal(result.outcome, "deployed");
  assert.deepEqual(result.alert, { action: "unread", closed: [] });
  assert.ok(lines.some((line) => /::warning::.*could not be read/.test(line)));
  assert.ok(!lines.some((line) => /still open/.test(line)));
});

test("a no-op run never closes an open alert", async () => {
  // The load-bearing case: skipping every job proves nothing about whether
  // deploys work, so closing here would silence a live outage. Under a path
  // gate, no-op runs were the MAJORITY (46 of 90 in #763).
  const { fetchImpl, calls } = makeFetchStub({
    issues: [alertIssue(900, GATED_CONFIG.alertTitle)],
  });
  const { logger, lines } = capturingLogger();
  let summary = "";

  const result = await runDeployAlert({
    ...RUN,
    runUrl: "https://example.test/run/3",
    needs: apiShapedNoOpNeeds(),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger,
    config: GATED_CONFIG,
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
    ...RUN,
    runUrl: "https://example.test/run/3",
    needs: apiShapedNoOpNeeds(),
    fetchImpl,
    writeSummary: () => {},
    logger,
    config: GATED_CONFIG,
  });
  assert.ok(!lines.some((line) => line.startsWith("::error::")));
});

test("a total API outage still writes the summary and never throws", async () => {
  // Fail-safe: the reporting half must survive the alerting half being down.
  const fetchImpl = async () => jsonResponse(500, { message: "server error" });
  let summary = "";
  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("failure", "deploy"),
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
    ...RUN,
    needs: stagingNeeds("failure", "deploy"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
  });
  assert.equal(result.alert.action, "failed");
});

// ── The Deploy staging configuration (#2803) ────────────────────────────────
// The one live config: a gateless `deploy` job with a plan output. These pin
// its behaviour, and the ways a config could quietly break another: a shared
// alert title (two watchdogs closing each other's issues), a gate job it does
// not have, and `config` dropped somewhere it has to be threaded through.
// Because DEPLOY_STAGING_CONFIG is also the default, that last kind of break is
// visible only on a non-default config, so each "names itself" test also runs
// API_SHAPED_CONFIG, the stand-in for the next config (#2805).

test("resolveAlertConfig resolves every name and refuses everything else", () => {
  assert.equal(resolveAlertConfig("deploy-staging"), DEPLOY_STAGING_CONFIG);
  for (const [name, config] of Object.entries(ALERT_CONFIGS)) {
    assert.equal(resolveAlertConfig(name), config);
    assert.equal(config.name, name, "a config's key and its name must agree");
  }

  // A typo'd ALERT_CONFIG must be loud.
  assert.throws(() => resolveAlertConfig("deploy-stagin"), /ALERT_CONFIG/);

  // An ABSENT one must be loud too, and this is the likelier mistake: another
  // deploy workflow copying a deploy-outcome block and dropping the line.
  // Resolving it to the staging config would read that workflow's own `deploy`
  // job as staging's, and reopen or comment on the live P1 staging alert from
  // an unrelated failure.
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
  assert.throws(() => resolveAlertConfig("nope"), /Known configurations: deploy-staging, deploy-production\./);
});

test("the retired config names are refused, not resolved to their replacement", () => {
  // `deploy-api.yml` and `deploy-vercel-staging.yml` were deleted by #2803 and
  // their configs with them. A workflow still passing either name (a stale
  // branch, a partial revert) must fail loud: quietly resolving it to
  // deploy-staging would read its jobs as staging's and write to the live P1
  // alert.
  for (const retired of ["deploy-api", "deploy-vercel-staging"]) {
    assert.throws(
      () => resolveAlertConfig(retired),
      (error) => {
        assert.ok(error.message.includes(`ALERT_CONFIG "${retired}"`), error.message);
        assert.match(error.message, /Known configurations: deploy-staging, deploy-production\./);
        return true;
      },
      retired,
    );
  }
});

test("no two configurations share an alert issue identity", () => {
  // Title is the lookup key. If any two ever matched, one watchdog's green run
  // would close the other's live outage alert.
  const titles = Object.values(ALERT_CONFIGS).map((config) => config.alertTitle);
  assert.equal(new Set(titles).size, titles.length);

  // Nor may a live title also be a retired one, a config's own or another's.
  // resolveAlert closes every retired title's open issue on success, so a
  // config retiring a title another config still raises would close that
  // watchdog's open incident with a "replaced" comment.
  const retired = Object.values(ALERT_CONFIGS).flatMap((config) => config.retiredAlertTitles ?? []);
  for (const title of titles) {
    assert.ok(!retired.includes(title), `live title is also retired: ${title}`);
  }

  // Every config declares the lookup label. This asserts CONFIG SHAPE, not
  // findability: `lib/alert-issue.mjs` forces `lookupLabel` into the created
  // label set precisely so a caller cannot omit it, and that forcing — not
  // this assertion — is what guarantees an alert can be found again. Do not
  // read this test as making that belt-and-braces redundant.
  for (const config of Object.values(ALERT_CONFIGS)) {
    assert.ok(config.alertLabels.includes(ALERT_LOOKUP_LABEL), `${config.name} lookup label`);
  }

  // The stand-ins' titles are neither a live nor a retired title, or the
  // isolation tests below, which use them as "another watchdog's alert",
  // would pass vacuously.
  for (const standIn of [API_SHAPED_CONFIG, GATED_CONFIG]) {
    assert.ok(![...titles, ...retired].includes(standIn.alertTitle), standIn.name);
  }
});

test("a gateless config reports only its deploy jobs", () => {
  assert.equal(DEPLOY_STAGING_CONFIG.gateJob, null);
  assert.deepEqual(alertJobNames(DEPLOY_STAGING_CONFIG), ["deploy"]);
  // A gated config reports its gate first.
  assert.deepEqual(alertJobNames(API_SHAPED_CONFIG), [
    "check-changes",
    "migrate-staging",
    "deploy-staging",
  ]);
});

test("a gateless config treats its succeeding deploy job as a deploy, not a gate", () => {
  const config = DEPLOY_STAGING_CONFIG;
  const jobResults = readJobResults(stagingNeeds("success", "deploy"), config);
  assert.deepEqual(jobResults, { deploy: "success" });

  const { outcome, deployed, failed } = classifyDeployOutcome({ jobResults, config });
  assert.equal(outcome, "deployed");
  assert.deepEqual(deployed, ["deploy"]);
  assert.deepEqual(failed, []);
});

test("a failed Deploy staging run classifies as failed and names the job", () => {
  const config = DEPLOY_STAGING_CONFIG;
  const { outcome, failed } = classify(stagingNeeds("failure", "deploy"), config);
  assert.equal(outcome, "failed");
  assert.deepEqual(failed, ["deploy"]);

  const headline = buildHeadline({ outcome, failed, deployed: [], headBranch: "main", config });
  assert.match(headline, /^Deploy staging FAILED on `main`/);
  // It must not claim to be another watchdog.
  assert.doesNotMatch(headline, /API-shaped stand-in/);

  // And a non-default config's headline is its own, so buildHeadline reads
  // the config it is given rather than the default.
  const standIn = buildHeadline({
    outcome: "failed",
    failed: ["deploy-staging"],
    deployed: [],
    headBranch: "main",
    config: API_SHAPED_CONFIG,
  });
  assert.match(standIn, /^API-shaped stand-in FAILED on `main`/);
  assert.doesNotMatch(standIn, /Deploy staging/);
});

test("a cancelled or timed-out staging deploy is a failure, not a benign skip", () => {
  for (const badResult of ["cancelled", "timed_out"]) {
    const { outcome, failed } = classify(stagingNeeds(badResult));
    assert.equal(outcome, "failed", badResult);
    assert.deepEqual(failed, ["deploy"], badResult);
  }
});

test("a gateless config's summary renders no changed-path rows", () => {
  const config = DEPLOY_STAGING_CONFIG;
  const jobResults = readJobResults(stagingNeeds("failure", "deploy"), config);
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

  assert.match(summary, /^## Deploy staging outcome/);
  assert.match(summary, /\| `deploy` \| failure \|/);
  // The whole point of gateOutputRows being empty: a workflow with no path gate
  // must not print "unknown" for a question it never asks.
  assert.doesNotMatch(summary, /paths changed/);
  assert.doesNotMatch(summary, /check-changes/);
});

test("the Deploy staging alert issue body names its own workflow and history", () => {
  const body = buildAlertIssueBody({
    headline: "Deploy staging FAILED on `main` — deploy did not succeed.",
    failed: ["deploy"],
    headBranch: "main",
    headSha: "4de96af",
    runUrl: "https://example.test/run/1",
    config: DEPLOY_STAGING_CONFIG,
  });

  assert.match(body, /## Deploy staging is failing/);
  assert.ok(body.includes("`.github/workflows/deploy-staging.yml`"));
  // Both histories it inherited: Deploy API's 71-day outage and the frozen
  // staging frontends.
  assert.match(body, /#763/);
  assert.match(body, /ADR-21/);
  assert.match(body, /#1674/);
  // It must not send a responder to a workflow that no longer exists, nor
  // inherit another config's prose.
  assert.doesNotMatch(body, /deploy-api\.yml/);
  assert.doesNotMatch(body, /deploy-vercel-staging\.yml/);
  assert.doesNotMatch(body, /stand-in/i);
  // Still tells a reader not to claim it as backlog work.
  assert.ok(body.includes(`carries \`${ALERT_LOOKUP_LABEL}\``));

  // A non-default config's body is its own throughout.
  const standIn = buildAlertIssueBody({
    headline: "API-shaped stand-in FAILED on `main` — deploy-staging did not succeed.",
    failed: ["deploy-staging"],
    headBranch: "main",
    headSha: "4de96af",
    config: API_SHAPED_CONFIG,
  });
  assert.match(standIn, /## API-shaped stand-in is failing/);
  assert.ok(standIn.includes("`.github/workflows/api-shaped-stand-in.yml`"));
  assert.ok(standIn.includes(API_SHAPED_CONFIG.whyLines[0]));
  assert.doesNotMatch(standIn, /Deploy staging/);
  assert.doesNotMatch(standIn, /deploy-staging\.yml/);
  assert.doesNotMatch(standIn, /ADR-21/);
});

test("runDeployAlert files each config's alert under its own title, labels and body", async () => {
  const cases = [
    { config: DEPLOY_STAGING_CONFIG, needs: stagingNeeds("failure", "deploy"), priority: "P1", other: API_SHAPED_CONFIG },
    { config: API_SHAPED_CONFIG, needs: apiShapedFailedNeeds(), priority: "P3", other: DEPLOY_STAGING_CONFIG },
    { config: DEPLOY_PRODUCTION_CONFIG, needs: productionNeeds("failure"), priority: "P1", other: DEPLOY_STAGING_CONFIG },
  ];
  for (const { config, needs, priority, other } of cases) {
    const { fetchImpl, calls } = makeFetchStub({ issues: [] });
    let summary = "";

    const result = await runDeployAlert({
      ...RUN,
      needs,
      fetchImpl,
      writeSummary: (text) => {
        summary = text;
      },
      logger: silentLogger,
      config,
    });

    assert.equal(result.outcome, "failed", config.name);
    assert.equal(result.alert.action, "created", config.name);

    const created = calls.find((call) => call.method === "POST" && call.path === "/repos/o/r/issues");
    assert.equal(created.body.title, config.alertTitle);
    assert.notEqual(created.body.title, other.alertTitle);
    assert.deepEqual(created.body.labels, config.alertLabels, config.name);
    assert.ok(created.body.labels.includes(ALERT_LOOKUP_LABEL), config.name);
    assert.ok(created.body.labels.includes(priority), `${config.name} is ${priority}`);
    assert.ok(summary.startsWith(`## ${config.workflowLabel} outcome`), config.name);

    // The BODY too, not just the title. `raiseAlert` passes `config.alertTitle`
    // to the library directly but builds the body through a closure, so those
    // two can disagree: dropping `config` from the closure yields an issue
    // titled for one config whose body opens "## Deploy staging is failing" and
    // points at deploy-staging.yml. Asserting the title alone did not catch
    // that, and only the non-default config can.
    assert.ok(created.body.body.includes(`## ${config.workflowLabel} is failing`), config.name);
    assert.ok(created.body.body.includes(config.workflowFile), config.name);
    assert.ok(!created.body.body.includes(`## ${other.workflowLabel} is failing`), config.name);
    assert.ok(!created.body.body.includes(other.workflowFile), config.name);
  }
});

test("a recovered run closes only its own alert, never another config's", async () => {
  // Deploy staging also closes its OWN retired titles (#960 here). The
  // stand-in retires nothing, so it must leave that issue alone as well: a
  // retired title belongs to the config that replaced it, not to every config.
  const issues = [
    alertIssue(950, DEPLOY_STAGING_CONFIG.alertTitle),
    alertIssue(951, API_SHAPED_CONFIG.alertTitle),
    alertIssue(952, DEPLOY_PRODUCTION_CONFIG.alertTitle),
    alertIssue(960, RETIRED_API_TITLE),
  ];
  const cases = [
    { config: DEPLOY_STAGING_CONFIG, needs: stagingNeeds("success", "deploy"), closes: [950, 960] },
    { config: API_SHAPED_CONFIG, needs: apiShapedDeployedNeeds(), closes: [951] },
    // A production success closes production's alert and no staging one: the
    // two environments fail independently.
    { config: DEPLOY_PRODUCTION_CONFIG, needs: productionNeeds("success"), closes: [952] },
  ];
  for (const { config, needs, closes } of cases) {
    const { fetchImpl, calls } = makeFetchStub({ issues });

    const result = await runDeployAlert({
      ...RUN,
      needs,
      fetchImpl,
      writeSummary: () => {},
      logger: silentLogger,
      config,
    });

    assert.equal(result.outcome, "deployed", config.name);
    assert.deepEqual(result.alert, { action: "closed", closed: closes }, config.name);
    // The cross-watchdog regression the shared-title check above exists to
    // prevent: every other alert is untouched.
    const patched = calls.filter((call) => call.method === "PATCH").map((call) => call.path);
    assert.deepEqual(
      patched,
      closes.map((number) => `/repos/o/r/issues/${number}`),
      config.name,
    );
  }
});

test("a gateless config escalates 'nothing ran' to a failure, not a benign no-op", async () => {
  // The regression: `needs: [deploy]` does not stop an always() job when its
  // dependency is skipped. If the two `if:` blocks ever drift, every merge
  // deploys nothing to staging while the run stays green — and the only signal
  // would be an annotation on a `workflow_run` page, which lands on no commit
  // and no PR. That is the ADR-21 frozen-staging failure verbatim, so it has to
  // raise a real alert.
  const config = DEPLOY_STAGING_CONFIG;
  const { outcome, failed } = classify(stagingNeeds("skipped"), config);

  assert.equal(outcome, "failed");
  assert.deepEqual(failed, ["deploy"]);

  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("skipped"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config,
  });
  assert.equal(result.alert.action, "created");
  const created = calls.find((c) => c.method === "POST" && c.path === "/repos/o/r/issues");
  assert.equal(created.body.title, DEPLOY_STAGING_CONFIG.alertTitle);
});

test("the gated config keeps a no-op benign, and never closes an open alert", async () => {
  // The other half of the same switch. 46 of the 90 runs in #763 were
  // green-because-empty; treating those as failures would have alerted on every
  // docs-only push, and treating them as recoveries would have closed a live
  // outage's alert. Both directions must stay wrong-proof. (No live config has
  // had a path gate since #2505; the stand-in keeps the benign branch tested.)
  assert.equal(GATED_CONFIG.noOpIsUnexpected, false);
  assert.equal(classify(apiShapedNoOpNeeds(), GATED_CONFIG).outcome, "no-op");

  const { fetchImpl, calls } = makeFetchStub({
    issues: [alertIssue(900, GATED_CONFIG.alertTitle)],
  });
  const result = await runDeployAlert({
    ...RUN,
    needs: apiShapedNoOpNeeds(),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config: GATED_CONFIG,
  });
  assert.equal(result.alert.action, "none");
  assert.deepEqual(
    calls.filter((c) => c.method !== "GET"),
    [],
    "a no-op must write nothing at all",
  );
});

test("a SECOND failure comments as its own config, never as another", async () => {
  // The gap this closes: `config` is threaded into raiseAlert's buildCommentBody
  // closure, and a stub with `issues: []` only ever reaches the CREATE path.
  // Deleting `config` from that closure left every create-path test green
  // while, in production, the second and every later failure of a non-default
  // config would comment "**Deploy staging failed again.**" onto its alert:
  // the wrong watchdog named in the wrong incident thread.
  const cases = [
    { config: DEPLOY_STAGING_CONFIG, needs: stagingNeeds("failure", "deploy"), other: API_SHAPED_CONFIG },
    { config: API_SHAPED_CONFIG, needs: apiShapedFailedNeeds(), other: DEPLOY_STAGING_CONFIG },
  ];
  for (const { config, needs, other } of cases) {
    const { fetchImpl, calls } = makeFetchStub({ issues: [alertIssue(950, config.alertTitle)] });

    const result = await runDeployAlert({
      ...RUN,
      needs,
      fetchImpl,
      writeSummary: () => {},
      logger: silentLogger,
      config,
    });

    assert.equal(result.alert.action, "commented", config.name);
    const comment = calls.find(
      (c) => c.method === "POST" && c.path === "/repos/o/r/issues/950/comments",
    ).body.body;
    assert.ok(comment.startsWith(`**${config.workflowLabel} failed again.**`), config.name);
    assert.ok(!comment.includes(other.workflowLabel), config.name);
  }
});

test("a reopened alert names its own config in the reopen comment", async () => {
  const cases = [
    { config: DEPLOY_STAGING_CONFIG, needs: stagingNeeds("failure", "deploy"), other: API_SHAPED_CONFIG },
    { config: API_SHAPED_CONFIG, needs: apiShapedFailedNeeds(), other: DEPLOY_STAGING_CONFIG },
  ];
  for (const { config, needs, other } of cases) {
    const { fetchImpl, calls } = makeFetchStub({
      issues: [alertIssue(950, config.alertTitle, "closed")],
    });

    const result = await runDeployAlert({
      ...RUN,
      needs,
      fetchImpl,
      writeSummary: () => {},
      logger: silentLogger,
      config,
    });

    assert.equal(result.alert.action, "reopened", config.name);
    const comment = calls.find(
      (c) => c.method === "POST" && c.path === "/repos/o/r/issues/950/comments",
    ).body.body;
    assert.ok(
      comment.startsWith(`**${config.workflowLabel} is failing again** — reopening.`),
      config.name,
    );
    assert.ok(!comment.includes(other.workflowLabel), config.name);
  }
});

test("the recovery comment names its own config, never another", async () => {
  // Same hole on the resolve path: `a recovered run closes only its own alert`
  // asserts which issue was PATCHed but never reads the comment, so dropping
  // `config` from buildRecoveryBody was invisible.
  const cases = [
    { config: DEPLOY_STAGING_CONFIG, needs: stagingNeeds("success", "deploy"), other: API_SHAPED_CONFIG },
    { config: API_SHAPED_CONFIG, needs: apiShapedDeployedNeeds(), other: DEPLOY_STAGING_CONFIG },
  ];
  for (const { config, needs, other } of cases) {
    const { fetchImpl, calls } = makeFetchStub({ issues: [alertIssue(950, config.alertTitle)] });

    await runDeployAlert({
      ...RUN,
      needs,
      fetchImpl,
      writeSummary: () => {},
      logger: silentLogger,
      config,
    });

    const comment = calls.find(
      (c) => c.method === "POST" && c.path === "/repos/o/r/issues/950/comments",
    ).body.body;
    assert.ok(comment.startsWith(`**${config.workflowLabel} recovered.** Closing.`), config.name);
    assert.ok(!comment.includes(other.workflowLabel), config.name);
    assert.doesNotMatch(comment, /Replaced by/, config.name);
  }
});

// ── Every caller names itself ───────────────────────────────────────────────

test("every workflow running deploy-alert.mjs sets a known ALERT_CONFIG", () => {
  // `main()` calls requireEnv("ALERT_CONFIG"), so a workflow that omits it
  // fails at deploy time — loud, but only once a deploy actually runs. This
  // catches it in CI instead, and covers workflows added later: it discovers
  // callers by scanning, rather than listing the ones that exist today.
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
  // #2803 merged deploy-api.yml and deploy-vercel-staging.yml into
  // deploy-staging.yml; #2805 added deploy-production.yml.
  assert.deepEqual(
    callers.map((c) => c.name).sort(),
    ["deploy-production.yml", "deploy-staging.yml"],
    "expected exactly the known callers — add a new one to this list deliberately",
  );

  // Tolerates the forms a human will actually write: quoted or bare, with or
  // without a trailing comment. A guard that fails on `ALERT_CONFIG: "deploy-staging"`
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

  // And each caller selects its own config.
  assert.deepEqual([...claimedBy.get("deploy-staging")], ["deploy-staging.yml"]);
  assert.deepEqual([...claimedBy.get("deploy-production")], ["deploy-production.yml"]);
});

test("an escalated no-op explains its own job table instead of contradicting it", () => {
  // Escalation puts a job whose result is `skipped` into `failed`. Reported
  // with the ordinary failure copy that renders as a contradiction the reader
  // cannot resolve — a red "FAILED" badge and "deploy did not succeed" above a
  // table saying `deploy | skipped` — which sends them hunting for a failed
  // build that does not exist.
  const config = DEPLOY_STAGING_CONFIG;
  const jobResults = readJobResults(stagingNeeds("skipped"), config);
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
  assert.match(summary, /the two have drifted apart/);
});

test("escalation leaves the gated config's classify shape untouched", () => {
  // `escalated` is spread in only when true, so a benign no-op returns
  // exactly the three keys it always did. A differential harness compares these
  // objects; an unconditional key would break that parity for no benefit.
  const result = classify(apiShapedNoOpNeeds(), GATED_CONFIG);
  assert.deepEqual(Object.keys(result).sort(), ["deployed", "failed", "outcome"]);
  assert.equal(result.outcome, "no-op");
});

test("an escalated alert issue does not call a job that never ran a failed job", async () => {
  // "Failed jobs: `deploy`" for a job whose result is `skipped` sends the
  // responder into a run with no failing step, looking for a build that never
  // started. The alert issue is the surface they read first, so the label has
  // to match what actually happened.
  const config = DEPLOY_STAGING_CONFIG;
  const { fetchImpl, calls } = makeFetchStub({ issues: [] });

  await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("skipped"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config,
  });

  const created = calls.find((c) => c.method === "POST" && c.path === "/repos/o/r/issues");
  assert.match(created.body.body, /Jobs that did not run: `deploy`/);
  assert.doesNotMatch(created.body.body, /Failed jobs/);

  // A genuine failure keeps the ordinary label.
  const second = makeFetchStub({ issues: [] });
  await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("failure", "deploy"),
    fetchImpl: second.fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config,
  });
  const realFailure = second.calls.find(
    (c) => c.method === "POST" && c.path === "/repos/o/r/issues",
  );
  assert.match(realFailure.body.body, /Failed jobs: `deploy`/);
});

test("an escalated run says 'did not run' on EVERY surface, not just the summary", async () => {
  // This goes through runDeployAlert on purpose. The earlier escalated test
  // called buildHeadline directly with `escalated` hand-passed, so it asserted
  // a property of a headline it had constructed correctly itself — and was
  // structurally unable to catch the real defect, which was runDeployAlert
  // failing to pass the flag to its own buildHeadline call. The result: the
  // annotation and the alert issue said "did not succeed" while the summary
  // three lines away said "did not run at all".
  const config = DEPLOY_STAGING_CONFIG;
  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  const { logger, lines } = capturingLogger();
  let summary = "";

  await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("skipped"),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger,
    config,
  });

  const annotation = lines.find((line) => line.startsWith("::"));
  const issueBody = calls.find(
    (c) => c.method === "POST" && c.path === "/repos/o/r/issues",
  ).body.body;

  // All three surfaces, checked together — a fix applied to one only is the
  // defect this replaces.
  for (const [surface, text] of [
    ["annotation", annotation],
    ["issue body", issueBody],
    ["step summary", summary],
  ]) {
    assert.match(text, /did not run|did not even attempt/, `${surface} must say nothing ran`);
    assert.doesNotMatch(text, /did not succeed/, `${surface} must not claim a failed attempt`);
  }

  // The diagnosis has to reach the durable artifact, not only the run page:
  // the issue outlives log retention and is what ALERT_ROUTING.md links to.
  assert.match(issueBody, /the two have drifted apart/);
});

test("a genuine failure still reads as a failure on every surface", async () => {
  // The other side of the switch — the escalated copy must not leak into an
  // ordinary failed deploy, which really did try and really did fail.
  const config = DEPLOY_STAGING_CONFIG;
  const { fetchImpl, calls } = makeFetchStub({ issues: [] });
  const { logger, lines } = capturingLogger();
  let summary = "";

  await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("failure", "deploy"),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger,
    config,
  });

  const annotation = lines.find((line) => line.startsWith("::"));
  const issueBody = calls.find(
    (c) => c.method === "POST" && c.path === "/repos/o/r/issues",
  ).body.body;

  for (const [surface, text] of [
    ["annotation", annotation],
    ["issue body", issueBody],
    ["step summary", summary],
  ]) {
    assert.match(text, /did not succeed/, `${surface} must report a real failure`);
    assert.doesNotMatch(text, /did not even attempt/, `${surface} must not claim nothing ran`);
  }
  assert.doesNotMatch(issueBody, /the two have drifted apart/);
});

test("every config's copy reads the same on every surface a responder reads", () => {
  // `OUTCOME_COPY` is shared; pinned on the headline, the issue body and the
  // comment, for the real config and for a stand-in that declares no
  // `closesOn`. Only what closes the issue differs: a Deploy staging `forward`
  // deploy succeeds without closing it, so it says so (`closesOn`); a config
  // without a plan closes on any successful deploy (the default).
  const closesOn = new Map([
    [DEPLOY_STAGING_CONFIG, "a later run for `main`'s tip deploys successfully or finds the API up to date"],
    [DEPLOY_PRODUCTION_CONFIG, "a later real `full` Deploy production run ships successfully"],
    [GATED_CONFIG, "a later run deploys successfully"],
  ]);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\`]/g, "\\$&");
  for (const config of [DEPLOY_STAGING_CONFIG, DEPLOY_PRODUCTION_CONFIG, GATED_CONFIG]) {
    const headline = buildHeadline({
      outcome: "failed",
      failed: ["deploy"],
      deployed: [],
      headBranch: "main",
      config,
    });
    assert.match(headline, /did not succeed\. Nothing is confirmed deployed by this run; its log says which step failed\.$/);
    const body = buildAlertIssueBody({
      headline,
      failed: ["deploy"],
      headBranch: "main",
      headSha: "4de96af",
      config,
    });
    assert.match(
      body,
      new RegExp(
        `the most recent \`${config.workflowLabel}\` run that actually tried to deploy did\\nnot succeed\\. ` +
          `It closes itself as soon as ${escape(closesOn.get(config))}\\.`,
      ),
    );
    const comment = buildAlertCommentBody({
      headline,
      failed: ["deploy"],
      headBranch: "main",
      headSha: "4de96af",
      reopened: false,
      config,
    });
    assert.match(comment, new RegExp(`This issue closes itself when ${escape(closesOn.get(config))}\\._$`));
  }
  assert.match(
    buildHeadline({ outcome: "no-op", failed: [], deployed: [], headBranch: "main" }),
    /deployed NOTHING on `main` — .*\. This run is green because it declined to deploy, not because a deploy succeeded\.$/,
  );
});

// ── Deploy staging's plan (#2505, #2803) ────────────────────────────────────
// The `deploy` job publishes plan-staging-deploy.mjs's verdict as `plan`. A
// job result alone can't tell a deploy from "the API needed no deploy" from
// "this run is for an old commit", and each must be reported and alerted
// differently.

test("a stale plan neither closes nor raises the alert", async () => {
  // The case: an alert is open for the newest commit's failed build, and a
  // re-run of an older run plans `stale`. Classifying it would count the green
  // `deploy` job as a deploy and close the alert. A retired-title issue stays
  // open too: a superseded run decides nothing.
  const { fetchImpl, calls } = makeFetchStub({
    issues: [OPEN_ALERT, alertIssue(960, RETIRED_API_TITLE)],
  });
  let summary = "";
  const result = await runDeployAlert({
    ...RUN,
    runUrl: "https://example.test/run/9",
    headSha: "0ldc0mm",
    needs: stagingNeeds("success", "stale"),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
  });
  assert.equal(result.outcome, "superseded");
  assert.equal(result.alert.action, "none");
  assert.equal(calls.length, 0, "a superseded run must not touch the issues API");
  assert.match(summary, /SUPERSEDED/);
  assert.match(summary, /\| Deploy plan \| `stale` \|/);
  assert.doesNotMatch(summary, /DEPLOYED/);
});

test("a stale plan on one of several jobs is superseded even with a sibling job green", async () => {
  // The multi-job form of the case above, on the stand-in (the retired Deploy
  // API shape, where #2505 found it): `migrate-staging` succeeding must not
  // turn a `stale` run into a deploy that closes the alert.
  const { fetchImpl, calls } = makeFetchStub({
    issues: [alertIssue(951, API_SHAPED_CONFIG.alertTitle)],
  });
  const result = await runDeployAlert({
    ...RUN,
    headSha: "0ldc0mm",
    needs: apiShapedDeployedNeeds("stale"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config: API_SHAPED_CONFIG,
  });
  assert.equal(result.outcome, "superseded");
  assert.equal(result.alert.action, "none");
  assert.equal(calls.length, 0, "a superseded run must not touch the issues API");
});

// A queue-replaced job (GitHub cancels a pending job when a third run
// arrives) is a failure like any other cancel. Telling it apart would rest on
// whether GitHub publishes a cancelled job's outputs, and a hung deploy with no
// timeout would hide behind a stream of such runs.
test("a deploy job cancelled before it planned is a failure", async () => {
  const { fetchImpl } = makeFetchStub({ issues: [] });
  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("cancelled"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.alert.action, "created");
});

test("a deploy cancelled after it planned is still a failure", async () => {
  // Cancelled mid-deploy: the commit is not confirmed live. Only a green
  // `stale` or `forward` plan is superseded.
  const { fetchImpl } = makeFetchStub({ issues: [] });
  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("cancelled", "deploy"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.alert.action, "created");
});

test("a current plan closes the alert but never claims DEPLOYED", async () => {
  // `current` is only published for main's tip, after verifying the API serves
  // and is ready, so it may close an alert. The API deployed nothing, and the
  // summary must say so at a glance (#763), without claiming nothing shipped:
  // the same run uploads web and landing (#2803 review).
  const { fetchImpl } = makeFetchStub({ issues: [OPEN_ALERT] });
  let summary = "";
  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("success", "current"),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
  });
  assert.equal(result.outcome, "deployed");
  assert.deepEqual(result.alert.closed, [900]);
  assert.match(summary, /API UP TO DATE — no API deploy needed/);
  assert.match(summary, /The API needed no deploy; staging was verified serving it/);
  assert.doesNotMatch(summary, /nothing needed deploying/i);
  assert.doesNotMatch(summary, /✅ \*\*DEPLOYED\*\*/);
});

test("a deploy plan that succeeds reports DEPLOYED with its plan row", async () => {
  const { fetchImpl } = makeFetchStub({ issues: [] });
  let summary = "";
  await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("success", "deploy"),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
  });
  assert.match(summary, /✅ \*\*DEPLOYED\*\*/);
  assert.match(summary, /\| Deploy plan \| `deploy` \|/);
});

// A run `main` moved past still deploys forward when it is newer than what
// staging serves (the tip's own run may never deploy). Its success says
// nothing about the tip, so it must not close the alert; its failure is a real
// failure of the deploy path.
test("a successful forward deploy leaves the alert alone", async () => {
  const { fetchImpl, calls } = makeFetchStub({ issues: [OPEN_ALERT] });
  let summary = "";
  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("success", "forward"),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
  });
  assert.equal(result.outcome, "superseded");
  assert.equal(calls.length, 0);
  assert.match(summary, /deployed this commit forward, but it is not main's tip/);
  assert.match(summary, /\| Deploy plan \| `forward` \|/);
});

test("a failed forward deploy raises the alert", async () => {
  const { fetchImpl } = makeFetchStub({ issues: [] });
  const result = await runDeployAlert({
    ...RUN,
    needs: stagingNeeds("failure", "forward"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.alert.action, "created");
});

test("readPlan and isSuperseded ignore a config without planOutput", () => {
  // A `stale` plan where both plan-reading configs look for one.
  const needs = { ...stagingNeeds("success", "stale"), ...apiShapedDeployedNeeds("stale") };
  assert.equal(readPlan(needs, GATED_CONFIG), null);
  assert.equal(isSuperseded(needs, GATED_CONFIG), false);
  // Control: the same needs ARE stale to the configs that read a plan, so the
  // results above are the missing `planOutput`'s doing.
  assert.equal(readPlan(needs, DEPLOY_STAGING_CONFIG), "stale");
  assert.equal(isSuperseded(needs, DEPLOY_STAGING_CONFIG), true);
  assert.equal(readPlan(needs, API_SHAPED_CONFIG), "stale");
});

// ── A rejected production approval (#2805) ──────────────────────────────────
// A reviewer declining the deployment fails `deploy` with nothing run. That is
// a decision, not an outage, so it must not open a P1; everything else that
// fails still must. The review history decides, not an output of the called
// job, which a failed call may not carry to the caller.

/** makeFetchStub, plus the run's review history at /actions/runs/77/approvals. */
function withApprovals(reviews, base = makeFetchStub({ issues: [] })) {
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/repos/o/r/actions/runs/77/approvals")) {
      base.calls.push({ method: "GET", path: "/repos/o/r/actions/runs/77/approvals", body: null });
      return reviews === null ? jsonResponse(403, { message: "Resource not accessible" }) : jsonResponse(200, reviews);
    }
    return base.fetchImpl(url, options);
  };
  return { fetchImpl, calls: base.calls };
}

test("approvalRejected reads the run's review history, and says when it can't", async () => {
  const read = (reviews, runId = "77") =>
    approvalRejected({ token: "t", repo: "o/r", runId, fetchImpl: withApprovals(reviews).fetchImpl });
  assert.equal(await read([{ state: "rejected", environments: [{ name: "production" }] }]), true);
  assert.equal(await read([{ state: "approved" }]), false);
  assert.equal(await read([]), false);
  assert.equal(await read(null), null, "an unreadable history is not a verdict");
  assert.equal(await read([{ state: "rejected" }], ""), null, "no run id, no read");
});

test("a rejected production approval neither raises nor closes the alert", async () => {
  const { fetchImpl, calls } = withApprovals([{ state: "rejected" }]);
  let summary = "";
  const result = await runDeployAlert({
    ...RUN,
    runId: "77",
    needs: productionNeeds("failure"),
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
    logger: silentLogger,
    config: DEPLOY_PRODUCTION_CONFIG,
  });
  assert.equal(result.outcome, "rejected");
  assert.deepEqual(result.alert, { action: "none" });
  assert.deepEqual(calls.map((c) => c.path), ["/repos/o/r/actions/runs/77/approvals"], "no issue read or written");
  assert.match(summary, /REJECTED — a reviewer declined the deployment; nothing ran/);
  assert.doesNotMatch(summary, /FAILED/);
});

test("a failed production deploy still raises when approved, or when the history can't be read", async () => {
  for (const reviews of [[{ state: "approved" }], null]) {
    const { fetchImpl, calls } = withApprovals(reviews);
    const result = await runDeployAlert({
      ...RUN,
      runId: "77",
      needs: productionNeeds("failure"),
      fetchImpl,
      writeSummary: () => {},
      logger: silentLogger,
      config: DEPLOY_PRODUCTION_CONFIG,
    });
    assert.equal(result.outcome, "failed", JSON.stringify(reviews));
    assert.equal(result.alert.action, "created", JSON.stringify(reviews));
    assert.ok(calls.some((c) => c.method === "POST" && c.path === "/repos/o/r/issues"));
  }
});

test("only the production config consults the approval history", async () => {
  assert.equal(DEPLOY_PRODUCTION_CONFIG.skipWhenApprovalRejected, true);
  assert.notEqual(DEPLOY_STAGING_CONFIG.skipWhenApprovalRejected, true, "staging has no approval to reject");
  const { fetchImpl, calls } = withApprovals([{ state: "rejected" }]);
  const result = await runDeployAlert({
    ...RUN,
    runId: "77",
    needs: stagingNeeds("failure", "deploy"),
    fetchImpl,
    writeSummary: () => {},
    logger: silentLogger,
    config: DEPLOY_STAGING_CONFIG,
  });
  assert.equal(result.outcome, "failed");
  assert.ok(!calls.some((c) => c.path.endsWith("/approvals")));
});
