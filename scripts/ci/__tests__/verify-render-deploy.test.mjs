import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  verifyRenderDeploy,
  RENDER_NO_DEPLOY_GRACE_MS,
  RENDER_POLL_INTERVAL_MS,
  RENDER_OVERALL_TIMEOUT_MS,
} from "../verify-render-deploy.mjs";

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

  it("exposes sane default constants", () => {
    assert.ok(RENDER_NO_DEPLOY_GRACE_MS > 0);
    assert.ok(RENDER_POLL_INTERVAL_MS > 0);
    assert.ok(RENDER_OVERALL_TIMEOUT_MS > RENDER_NO_DEPLOY_GRACE_MS);
  });
});
