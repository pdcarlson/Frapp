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

// An EARLIER successful deployment on `branch`. Deliberately not evidence of
// anything any more: it was the baseline a turbo-ignore skip diffed against,
// and on `main` one always exists, so treating it as exculpatory is what let a
// manual stop or a concurrency-limit cancel report green.
function priorSuccess({ branch = "main", createdAt = "2026-04-15T00:00:00Z" } = {}) {
  return vercelDeployment({
    sha: "0ldc0mm1t",
    state: "READY",
    uid: `dpl_prior_${branch}`,
    createdAt,
    branch,
  });
}

// A LATER deployment on `branch` — the push that overtook the candidate, and
// the only thing that makes a cancel benign. Left in whatever state the caller
// wants: a superseding build may still be running, and requiring it to be READY
// would fail the superseded one for losing a race it is meant to lose.
function laterDeployment({
  branch = "main",
  state = "READY",
  createdAt = "2026-04-17T00:00:00Z",
} = {}) {
  return vercelDeployment({
    sha: "newc0mm1t",
    state,
    uid: `dpl_later_${branch}`,
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

  it("returns neutral on CANCELED overtaken by a later deployment on the same branch", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [vercelDeployment({ state: "CANCELED" }), laterDeployment()],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
    assert.match(result.message, /superseded/);
  });

  it("stays neutral when the superseding deployment is still building", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [
          vercelDeployment({ state: "CANCELED" }),
          laterDeployment({ state: "BUILDING" }),
        ],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
  });

  // ── CANCELED that nothing overtook ────────────────────────────────────────
  // The gap this closes: a CANCELED deployment was an automatic pass, so a
  // project that never built could report green. Vercel auto-cancels a build
  // only when a NEWER push lands on the same branch, so supersession implies a
  // later deployment. Without one the cancel came from something else — a
  // manual stop, a build concurrency limit, or an Ignored Build Step that
  // skipped it — and nothing was verified.

  it("fails on CANCELED when no other deployment exists at all", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ state: "CANCELED" })] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /no later deployment/);
    assert.match(result.message, /CANCELED/);
  });

  // The regression guard for the cutover. Under the previous backward-looking
  // rule ("does an earlier success exist on this branch") this exact page
  // returned NEUTRAL — and on `main` an earlier success always exists, so every
  // cancel did. That is the false green the forward-looking rule removes.
  it("fails on CANCELED when every other deployment on the branch is older", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [vercelDeployment({ state: "CANCELED" }), priorSuccess()],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /no later deployment/);
  });

  it("fails on CANCELED when the only later deployment is on another branch", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [
          vercelDeployment({ state: "CANCELED", branch: "production" }),
          laterDeployment({ branch: "main" }),
        ],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /branch production/);
  });

  it("falls back to any later deployment when Vercel reports no branch", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [
          vercelDeployment({ state: "CANCELED", branch: null }),
          laterDeployment({ branch: "some-other-branch" }),
        ],
      }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "neutral");
  });

  // Was neutral while `ignoreCommand: "npx turbo-ignore <app>"` could legitimately
  // suppress a build. Both apps now pin `ignoreCommand: "exit 1"`, so nothing
  // suppresses one and a missing deployment row is a broken Git integration.
  it("fails when no deployment for the SHA exists within the grace window", async () => {
    const otherSha = "feedbeef1234";
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [vercelDeployment({ sha: otherSha, state: "READY" })] }),
    ]);
    const { clock } = makeFakeClock();

    const result = await verifyVercelDeploy({ ...defaults, clock, fetchImpl });

    assert.equal(result.status, "failure");
    assert.match(result.message, /No Vercel deployment/);
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

  // Replay of the real frapp-web deployment page around PR #1330, in the shape
  // the v6 endpoint actually returns (`created` as epoch ms, not `createdAt`).
  // Every uid, sha and timestamp here was read from the live API.
  //
  // What this guards is epoch-ms parsing in the supersession comparison — the
  // ordering test is the whole rule, so a field-shape miss would silently make
  // every real cancel compare as unordered. Asserted in both directions on the
  // same page.
  //
  // Note the cutover this encodes: as captured, that cancel was a turbo-ignore
  // skip and the old rule called it neutral because earlier successes sat
  // behind it. Nothing skips builds now, so the same page is a failure until a
  // later deployment overtakes it.
  it("reads epoch-ms `created` when deciding supersession on real data", async () => {
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
    // The real next push on main, ~84 minutes later (PR #1331's merge).
    const laterReady = {
      uid: "dpl_9xzrDJ7fCzXxGknqQaRxujNjxFEy",
      state: "READY",
      created: 1787933183873,
      meta: { githubCommitSha: "d6912052", githubCommitRef: "main" },
    };

    const olderOnly = makeFetchStub([
      okJson({ deployments: [canceledPreview, olderCancel, olderReady] }),
    ]);
    const withLater = makeFetchStub([
      okJson({ deployments: [canceledPreview, olderCancel, olderReady, laterReady] }),
    ]);

    const failed = await verifyVercelDeploy({
      ...defaults,
      clock: makeFakeClock().clock,
      fetchImpl: olderOnly.fetchImpl,
    });
    assert.equal(failed.status, "failure");
    assert.match(failed.message, /no later deployment/);

    const superseded = await verifyVercelDeploy({
      ...defaults,
      clock: makeFakeClock().clock,
      fetchImpl: withLater.fetchImpl,
    });
    assert.equal(superseded.status, "neutral");
    assert.match(superseded.message, /branch main/);
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
