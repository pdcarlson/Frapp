import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  verifyRenderDeploy,
  writeOutcomeOutput,
  isPermanentReadError,
  VERIFY_OUTCOMES,
  RENDER_MAX_CONSECUTIVE_READ_ERRORS,
  RENDER_NO_DEPLOY_GRACE_MS,
  RENDER_POLL_INTERVAL_MS,
  RENDER_OVERALL_TIMEOUT_MS,
} from "../verify-render-deploy.mjs";
import { VERIFY_DEPLOYMENTS_CONFIG } from "../deploy-alert.mjs";

const SHA = "abc1234def5678";
const SERVICE_ID = "srv-test";
const LABEL = "frapp-api-test";
const API_KEY = "test-key";

// Stable defaults so tests are fast but still cover realistic branches.
const TEST_NO_DEPLOY_GRACE_MS = 60 * 1000;
const TEST_POLL_INTERVAL_MS = 5 * 1000;
const TEST_OVERALL_TIMEOUT_MS = 10 * 60 * 1000;

function makeFakeClock() {
  let nowMs = 1_000_000;
  const slept = [];
  return {
    clock: {
      now: () => nowMs,
      sleep: async (ms) => {
        slept.push(ms);
        nowMs += ms;
      },
    },
    slept,
    advance(ms) {
      nowMs += ms;
    },
  };
}

function makeFetchStub(responses) {
  let callIndex = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const handler = responses[Math.min(callIndex, responses.length - 1)];
    callIndex += 1;
    if (typeof handler === "function") return handler();
    return handler;
  };
  return { fetchImpl, calls };
}

function okJson(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function renderDeploy({ sha = SHA, status, id = `dep-${status}` } = {}) {
  return {
    deploy: {
      id,
      commit: { id: sha, message: "test", createdAt: "2026-04-16T00:00:00Z" },
      status,
      trigger: "new_commit",
      createdAt: "2026-04-16T00:00:00Z",
      updatedAt: "2026-04-16T00:00:00Z",
    },
  };
}

const silentLogger = { log: () => {} };

const defaults = {
  apiKey: API_KEY,
  serviceId: SERVICE_ID,
  sha: SHA,
  label: LABEL,
  noDeployGraceMs: TEST_NO_DEPLOY_GRACE_MS,
  pollIntervalMs: TEST_POLL_INTERVAL_MS,
  overallTimeoutMs: TEST_OVERALL_TIMEOUT_MS,
  logger: silentLogger,
};

describe("verifyRenderDeploy", () => {
  it("returns success when the matching deploy is already live", async () => {
    const { fetchImpl, calls } = makeFetchStub([okJson([renderDeploy({ status: "live" })])]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
    assert.match(result.message, /live/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /srv-test\/deploys/);
    assert.match(calls[0].options.headers.Authorization, /Bearer test-key/);
  });

  it("polls until the deploy transitions from in-progress to live", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson([renderDeploy({ status: "build_in_progress" })]),
      okJson([renderDeploy({ status: "update_in_progress" })]),
      okJson([renderDeploy({ status: "live" })]),
    ]);
    const { clock, slept } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
    assert.equal(slept.length, 2);
    assert.deepEqual(slept, [TEST_POLL_INTERVAL_MS, TEST_POLL_INTERVAL_MS]);
  });

  it("returns failure on build_failed", async () => {
    const { fetchImpl } = makeFetchStub([okJson([renderDeploy({ status: "build_failed" })])]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /build_failed/);
  });

  it("returns failure on update_failed", async () => {
    const { fetchImpl } = makeFetchStub([okJson([renderDeploy({ status: "update_failed" })])]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /update_failed/);
  });

  it("returns failure on pre_deploy_failed", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson([renderDeploy({ status: "pre_deploy_failed" })]),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /pre_deploy_failed/);
  });

  it("returns neutral when the deploy was superseded (canceled)", async () => {
    const { fetchImpl } = makeFetchStub([okJson([renderDeploy({ status: "canceled" })])]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
    assert.match(result.message, /superseded|canceled/i);
  });

  it("returns neutral when the deploy has been deactivated by a newer deploy", async () => {
    const { fetchImpl } = makeFetchStub([okJson([renderDeploy({ status: "deactivated" })])]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
    assert.match(result.message, /superseded|deactivated/i);
  });

  it("fails with an autoDeploy-wiring message if no matching SHA appears within the grace window", async () => {
    const otherSha = "feedbeef1234";
    const { fetchImpl } = makeFetchStub([okJson([renderDeploy({ sha: otherSha, status: "live" })])]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /autoDeploy/i);
    assert.match(result.message, new RegExp(SHA));
  });

  it("succeeds if the matching SHA appears after some grace-window polling", async () => {
    const otherSha = "feedbeef1234";
    const { fetchImpl } = makeFetchStub([
      okJson([renderDeploy({ sha: otherSha, status: "live" })]),
      okJson([renderDeploy({ sha: otherSha, status: "live" })]),
      okJson([renderDeploy({ status: "live" })]),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
  });

  it("returns failure when the Render API responds with HTTP 500", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /Render API/);
    assert.match(result.message, /500/);
  });

  // Since #2431 a failure verdict files a P1, so a read error is re-asked on
  // the next poll, and only a permanent refusal or several failures in a row
  // end the run.
  const httpError = (status) => ({ ok: false, status, json: async () => ({}) });

  it("fails on the first poll when Render refuses the key (401), since re-asking can't help", async () => {
    const { fetchImpl, calls } = makeFetchStub([httpError(401)]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /HTTP 401/);
    assert.equal(calls.length, 1);
  });

  it("re-asks after a 408, which is about the request rather than the key", async () => {
    const { fetchImpl, calls } = makeFetchStub([
      httpError(408),
      okJson([renderDeploy({ status: "live" })]),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
    assert.equal(calls.length, 2);
  });

  it("re-asks after a 5xx and succeeds when the next read works", async () => {
    const { fetchImpl, calls } = makeFetchStub([
      httpError(502),
      okJson([renderDeploy({ status: "live" })]),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
    assert.equal(calls.length, 2);
  });

  it("re-asks after a body that fails mid-read, which the HTTP retry never covers", async () => {
    const { fetchImpl } = makeFetchStub([
      { ok: true, status: 200, json: async () => Promise.reject(new TypeError("terminated")) },
      okJson([renderDeploy({ status: "live" })]),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
  });

  it("fails after the maximum number of failed reads in a row, naming the count", async () => {
    const { fetchImpl, calls } = makeFetchStub([httpError(503)]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.equal(calls.length, RENDER_MAX_CONSECUTIVE_READ_ERRORS);
    assert.match(result.message, new RegExp(`${RENDER_MAX_CONSECUTIVE_READ_ERRORS} failed reads in a row`));
  });

  it("counts failed reads in a row, so a good read in between resets the count", async () => {
    const inProgress = okJson([renderDeploy({ status: "build_in_progress" })]);
    const { fetchImpl } = makeFetchStub([
      httpError(502),
      httpError(502),
      inProgress,
      httpError(502),
      httpError(502),
      okJson([renderDeploy({ status: "live" })]),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
  });

  it("classifies only 401, 403 and 404 as permanent read errors", () => {
    for (const status of [401, 403, 404]) assert.equal(isPermanentReadError({ status }), true, `${status}`);
    // A 408, 409 or 425 is about this request, not the key: re-asked, not paged.
    for (const status of [400, 408, 409, 422, 425, 429, 500, 502, 503]) {
      assert.equal(isPermanentReadError({ status }), false, `${status}`);
    }
    // A network or body error carries no status and is always re-asked.
    assert.equal(isPermanentReadError(new TypeError("fetch failed")), false);
    assert.equal(isPermanentReadError(undefined), false);
  });

  it("fails on overall timeout while deploys keep coming back as in-progress", async () => {
    const fetchImpl = async () => okJson([renderDeploy({ status: "build_in_progress" })]);
    const shortTimeout = TEST_POLL_INTERVAL_MS * 3;
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({
      ...defaults,
      clock,
      fetchImpl,
      overallTimeoutMs: shortTimeout,
    });

    assert.equal(result.status, "failure");
    assert.match(result.message, /Timed out/);
    assert.match(result.message, /build_in_progress/);
  });

  it("names the last failed read when it times out between failed reads", async () => {
    // Reads failing on and off, never enough in a row to stop early: the
    // timeout message is all the alert's run log has, and without this line
    // it would point at a stuck deploy rather than an unreadable Render.
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return call % 2 === 0 ? httpError(502) : okJson([renderDeploy({ status: "build_in_progress" })]);
    };
    const { clock } = makeFakeClock();

    const result = await verifyRenderDeploy({
      ...defaults,
      clock,
      fetchImpl,
      overallTimeoutMs: TEST_POLL_INTERVAL_MS * 6,
    });

    assert.equal(result.status, "failure");
    assert.match(result.message, /Timed out/);
    assert.match(result.message, /Last Render read failed: .*HTTP 502/);

    // And a clean timeout says nothing about reads.
    const clean = await verifyRenderDeploy({
      ...defaults,
      clock: makeFakeClock().clock,
      fetchImpl: async () => okJson([renderDeploy({ status: "build_in_progress" })]),
      overallTimeoutMs: TEST_POLL_INTERVAL_MS * 3,
    });
    assert.doesNotMatch(clean.message, /Last Render read failed/);
  });

  it("exposes sane default constants", () => {
    assert.ok(RENDER_NO_DEPLOY_GRACE_MS > 0);
    assert.ok(RENDER_POLL_INTERVAL_MS > 0);
    assert.ok(RENDER_OVERALL_TIMEOUT_MS > RENDER_NO_DEPLOY_GRACE_MS);
  });
});

// `verify-deployments.yml`'s `deploy-outcome` job closes the staging deploy
// alert only on this output's `success` (#2431), because `neutral` exits 0 too.
describe("writeOutcomeOutput", () => {
  function recorder() {
    const writes = [];
    return { writes, append: (path, text) => writes.push({ path, text }) };
  }

  it("appends exactly `outcome=<status>` for every verdict the verifier returns", () => {
    for (const status of ["success", "neutral", "failure"]) {
      const { writes, append } = recorder();
      writeOutcomeOutput(status, { outputPath: "/tmp/out", append });
      assert.deepEqual(writes, [{ path: "/tmp/out", text: `outcome=${status}\n` }]);
    }
  });

  // The default reads `GITHUB_OUTPUT`, which Actions sets for every step,
  // this suite's own CI run included. So both cases set it explicitly: a test
  // that left it to the environment passed locally and failed on the runner.
  function withGithubOutput(value, fn) {
    const saved = process.env.GITHUB_OUTPUT;
    if (value === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = value;
    try {
      fn();
    } finally {
      if (saved === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = saved;
    }
  }

  it("is a no-op outside Actions, where GITHUB_OUTPUT is unset or empty", () => {
    const { writes, append } = recorder();
    withGithubOutput(undefined, () => writeOutcomeOutput("success", { append }));
    withGithubOutput("", () => writeOutcomeOutput("success", { append }));
    assert.deepEqual(writes, []);
  });

  it("writes to GITHUB_OUTPUT by default", () => {
    const { writes, append } = recorder();
    withGithubOutput("/tmp/runner-output", () => writeOutcomeOutput("neutral", { append }));
    assert.deepEqual(writes, [{ path: "/tmp/runner-output", text: "outcome=neutral\n" }]);
  });

  it("refuses to publish a status outside the closed set, even outside Actions", () => {
    // Free text (a provider error message) must never reach the output: it
    // leaves this job, into deploy-alert.mjs's step summary.
    const { writes, append } = recorder();
    for (const bad of ["Render API error: 401", "SUCCESS", "", undefined]) {
      assert.throws(
        () => writeOutcomeOutput(bad, { outputPath: "/tmp/out", append }),
        /Unknown verify outcome/,
      );
      assert.throws(() => writeOutcomeOutput(bad, { outputPath: undefined, append }));
    }
    assert.deepEqual(writes, []);
  });

  it("publishes the vocabulary deploy-alert.mjs reads", () => {
    // The two files meet only through a string. If the verifier renamed its
    // success verdict, a live deploy could never close the alert again.
    const { value, neutral } = VERIFY_DEPLOYMENTS_CONFIG.deployedOutput;
    assert.ok(VERIFY_OUTCOMES.has(value));
    for (const n of neutral) assert.ok(VERIFY_OUTCOMES.has(n));
    assert.ok(!neutral.includes("failure"), "a failure must never read as neutral");
  });

  it("each verdict the verifier returns is one it may publish", async () => {
    const cases = [
      [okJson([renderDeploy({ status: "live" })]), "success"],
      [okJson([renderDeploy({ status: "canceled" })]), "neutral"],
      [okJson([renderDeploy({ status: "build_failed" })]), "failure"],
    ];
    for (const [response, expected] of cases) {
      const { fetchImpl } = makeFetchStub([response]);
      const { clock } = makeFakeClock();
      const result = await verifyRenderDeploy({ ...defaults, clock, fetchImpl });
      assert.equal(result.status, expected);
      assert.ok(VERIFY_OUTCOMES.has(result.status));
    }
  });
});
