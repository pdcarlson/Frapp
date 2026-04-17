import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  verifyVercelDeploy,
  VERCEL_NO_DEPLOY_GRACE_MS,
  VERCEL_POLL_INTERVAL_MS,
  VERCEL_OVERALL_TIMEOUT_MS,
} from "../verify-vercel-deploy.mjs";

const SHA = "abc1234def5678";
const PROJECT_ID = "prj_test";
const LABEL = "frapp-web-test";
const API_KEY = "test-key";

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

function vercelDeployment({
  sha = SHA,
  state,
  uid = `dpl_${state}`,
  createdAt = "2026-04-16T00:00:00Z",
} = {}) {
  return {
    uid,
    url: `${uid}.vercel.app`,
    state,
    readyState: state,
    createdAt,
    meta: { githubCommitSha: sha },
  };
}

const silentLogger = { log: () => {} };

const defaults = {
  apiKey: API_KEY,
  projectId: PROJECT_ID,
  sha: SHA,
  label: LABEL,
  noDeployGraceMs: TEST_NO_DEPLOY_GRACE_MS,
  pollIntervalMs: TEST_POLL_INTERVAL_MS,
  overallTimeoutMs: TEST_OVERALL_TIMEOUT_MS,
  logger: silentLogger,
};

describe("verifyVercelDeploy", () => {
  it("returns success when the matching deployment is READY", async () => {
    const { fetchImpl, calls } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ state: "READY" })] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
    assert.match(result.message, /READY/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /projectId=prj_test/);
    assert.match(calls[0].options.headers.Authorization, /Bearer test-key/);
  });

  it("polls from BUILDING to READY", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ state: "BUILDING" })] }),
      okJson({ deployments: [vercelDeployment({ state: "READY" })] }),
    ]);
    const { clock, slept } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
    assert.deepEqual(slept, [TEST_POLL_INTERVAL_MS]);
  });

  it("returns failure on ERROR", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ state: "ERROR" })] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /ERROR/);
  });

  it("returns neutral on CANCELED (turbo-ignore skip)", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ state: "CANCELED" })] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
    assert.match(result.message, /turbo-ignore|CANCELED/);
  });

  it("returns neutral when no deployment for the SHA exists within the grace window", async () => {
    const otherSha = "feedbeef1234";
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ sha: otherSha, state: "READY" })] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
    assert.match(result.message, /turbo-ignore|No Vercel deployment/);
  });

  it("succeeds when a deployment for the SHA appears after some polling", async () => {
    const otherSha = "feedbeef1234";
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ sha: otherSha, state: "READY" })] }),
      okJson({ deployments: [vercelDeployment({ sha: otherSha, state: "READY" })] }),
      okJson({ deployments: [vercelDeployment({ state: "READY" })] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
  });

  it("returns failure when Vercel API responds with HTTP 500", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /Vercel API/);
    assert.match(result.message, /500/);
  });

  it("picks the most recent deployment when several exist for the same SHA", async () => {
    const older = vercelDeployment({
      state: "ERROR",
      uid: "dpl_old",
      createdAt: "2026-04-16T00:00:00Z",
    });
    const newer = vercelDeployment({
      state: "READY",
      uid: "dpl_new",
      createdAt: "2026-04-16T01:00:00Z",
    });
    const { fetchImpl } = makeFetchStub([okJson({ deployments: [older, newer] })]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "success");
    assert.match(result.message, /dpl_new/);
  });

  it("times out to failure while deployment stays in BUILDING", async () => {
    const fetchImpl = async () =>
      okJson({ deployments: [vercelDeployment({ state: "BUILDING" })] });
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({
      ...defaults,
      clock,
      fetchImpl,
      overallTimeoutMs: TEST_POLL_INTERVAL_MS * 3,
    });

    assert.equal(result.status, "failure");
    assert.match(result.message, /Timed out/);
    assert.match(result.message, /BUILDING/);
  });

  it("exposes sane default constants", () => {
    assert.ok(VERCEL_NO_DEPLOY_GRACE_MS > 0);
    assert.ok(VERCEL_POLL_INTERVAL_MS > 0);
    assert.ok(VERCEL_OVERALL_TIMEOUT_MS > VERCEL_NO_DEPLOY_GRACE_MS);
  });
});
