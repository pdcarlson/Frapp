import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_ISSUE_LABELS,
  ALERT_ISSUE_TITLE,
  buildHeadline,
  buildRunSummary,
  classifyDeployOutcome,
  findAlertIssues,
  raiseAlert,
  readJobResults,
  resolveAlert,
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
