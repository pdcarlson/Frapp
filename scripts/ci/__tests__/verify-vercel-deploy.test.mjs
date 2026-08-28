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

// `branch: null` models a deployment whose branch Vercel did not report.
function vercelDeployment({
  sha = SHA,
  state,
  uid = `dpl_${state}`,
  createdAt = "2026-04-16T00:00:00Z",
  branch = "main",
} = {}) {
  const meta = { githubCommitSha: sha };
  if (branch !== null) meta.githubCommitRef = branch;
  return {
    uid,
    url: `${uid}.vercel.app`,
    state,
    readyState: state,
    createdAt,
    meta,
  };
}

// A successful earlier deployment on `branch` — the baseline turbo-ignore
// diffs against when it decides a project is unaffected.
function priorSuccess({ branch = "main", createdAt = "2026-04-15T00:00:00Z" } = {}) {
  return vercelDeployment({
    sha: "0ldc0mm1t",
    state: "READY",
    uid: `dpl_prior_${branch}`,
    createdAt,
    branch,
  });
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

  it("returns neutral on CANCELED when the branch has an earlier successful deployment", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [vercelDeployment({ state: "CANCELED" }), priorSuccess()],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
    assert.match(result.message, /turbo-ignore/);
  });

  // ── CANCELED without a baseline ───────────────────────────────────────────
  // The gap this closes: a CANCELED deployment was an automatic pass, so a
  // project that never built could report green. turbo-ignore can only skip
  // against an earlier successful deployment on the same branch; with no such
  // deployment the cancel came from something else (superseded push, manual
  // stop, concurrency limit) and nothing was verified.

  it("fails on CANCELED when no prior deployment exists at all", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ state: "CANCELED" })] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /no earlier successful deployment/);
    assert.match(result.message, /CANCELED/);
  });

  it("fails on CANCELED when the only earlier success is on another branch", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [
          vercelDeployment({ state: "CANCELED", branch: "production" }),
          priorSuccess({ branch: "main" }),
        ],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /branch production/);
  });

  it("fails on CANCELED when earlier deployments on the branch were themselves CANCELED", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [
          vercelDeployment({ state: "CANCELED" }),
          vercelDeployment({
            sha: "0ldc0mm1t",
            state: "CANCELED",
            uid: "dpl_older_cancel",
            createdAt: "2026-04-15T00:00:00Z",
          }),
        ],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /no earlier successful deployment/);
  });

  it("fails on CANCELED when the only success on the branch is newer than the cancel", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [
          vercelDeployment({ state: "CANCELED", createdAt: "2026-04-16T00:00:00Z" }),
          priorSuccess({ createdAt: "2026-04-17T00:00:00Z" }),
        ],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
  });

  it("falls back to any earlier success when Vercel reports no branch", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [
          vercelDeployment({ state: "CANCELED", branch: null }),
          priorSuccess({ branch: "some-other-branch" }),
        ],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
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

  // Replay of the real frapp-web page around PR #1330's preview, in the shape
  // the v6 endpoint actually returns (`created` as epoch ms, not `createdAt`).
  // That preview was a genuine turbo-ignore skip on a branch with a real
  // deployment history, so it must stay neutral — the stricter CANCELED rule
  // must not turn every legitimate skip red.
  it("stays neutral for a real turbo-ignore skip on a branch with history", async () => {
    const canceledPreview = {
      uid: "dpl_DMZsRAr8kvDuzAtfsAgFzJ3xa2Wg",
      url: "frapp-5odpw2a0f.vercel.app",
      state: "CANCELED",
      created: 1787928128939,
      meta: { githubCommitSha: SHA, githubCommitRef: "main" },
    };
    const olderCancel = {
      uid: "dpl_cancel_a52da32d",
      state: "CANCELED",
      created: 1787866887000,
      meta: { githubCommitSha: "a52da32d", githubCommitRef: "main" },
    };
    const olderReady = {
      uid: "dpl_6uU9xmnd54nqhqarsvdTya6ETF72",
      state: "READY",
      created: 1787867621695,
      meta: { githubCommitSha: "1f4263fb", githubCommitRef: "main" },
    };
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [canceledPreview, olderCancel, olderReady] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
    assert.match(result.message, /branch main/);
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
