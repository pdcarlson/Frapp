import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyVercelState,
  createVercelProductionDeployment,
  deployVercelProduction,
  pollVercelDeployment,
} from "../deploy-vercel-production.mjs";
import { verifyVercelDeploy } from "../verify-vercel-deploy.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const API_KEY = "test-key";
const TEAM_ID = "team_test";
const REPO_ID = "1157424895";

function makeFakeClock() {
  let nowMs = 1_000_000;
  return {
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
  };
}

const quiet = { log: () => {} };

function okJson(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function errJson(status, body = {}) {
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function makeFetchStub(responses) {
  let index = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const handler = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof handler === "function" ? handler() : handler;
  };
  return { fetchImpl, calls };
}

// ── The regression this whole file exists for ───────────────────────────────
//
// Before the cutover, production deployments lived on the `production` branch,
// which had no earlier successful deployments — Vercel's own build log said
// `No previous deployments found for "web" on branch "production"`. That is the
// ONLY reason `verify-vercel-deploy.mjs` could safely call a CANCELED
// deployment neutral.
//
// Deploying from `main` inverts the precondition: `main` has many READY
// deployments, so the "prior success" test is always true and every cancelled
// production build reads as a neutral no-op — green, forever, having shipped
// nothing.
//
// The first test pins TODAY's behaviour so the hole is documented rather than
// asserted about in a comment; the second pins the strict behaviour that
// replaces it.
// Why deploy-vercel-production.mjs polls its own deployment instead of reusing
// the observer. The two rules agree on an unexplained cancel and diverge on a
// superseded one — and on the production path even a superseded cancel means
// nothing shipped, so it can never be neutral.
describe("CANCELED on main: the production path is stricter than the observer", () => {
  const cancelledOnMain = {
    uid: "dpl_cancelled",
    state: "CANCELED",
    target: "production",
    createdAt: "2026-08-28T21:10:00Z",
    meta: { githubCommitSha: SHA, githubCommitRef: "main" },
  };
  const earlierSuccessOnMain = {
    uid: "dpl_earlier",
    state: "READY",
    target: null,
    createdAt: "2026-08-28T20:00:00Z",
    meta: { githubCommitSha: "deadbeef", githubCommitRef: "main" },
  };
  // Same channel as the candidate: supersession is per-channel, so a preview
  // landing later would NOT excuse a cancelled production build (and vice
  // versa). Models the next production dispatch overtaking this one.
  const laterDeploymentOnMain = {
    uid: "dpl_later",
    state: "READY",
    target: "production",
    createdAt: "2026-08-28T22:00:00Z",
    meta: { githubCommitSha: "feedbeef", githubCommitRef: "main" },
  };

  // The original hole: an earlier success on the branch made the observer call
  // this neutral, and on `main` an earlier success always exists. Both paths
  // now fail it — the observer asks whether a LATER deployment overtook it.
  it("the observer now also reports FAILURE when nothing overtook the cancel", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [cancelledOnMain, earlierSuccessOnMain] }),
    ]);

    const result = await verifyVercelDeploy({
      apiKey: API_KEY,
      projectId: "prj_test",
      sha: SHA,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });

    assert.equal(result.status, "failure");
    assert.match(result.message, /no later deployment/);
  });

  // Where they still diverge, and the reason this module exists: a superseded
  // cancel is benign for a staging push (the newer build verifies the branch)
  // and fatal for a release (the named commit was never built).
  it("the observer reports NEUTRAL for a superseded cancel", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({
        deployments: [cancelledOnMain, earlierSuccessOnMain, laterDeploymentOnMain],
      }),
    ]);

    const result = await verifyVercelDeploy({
      apiKey: API_KEY,
      projectId: "prj_test",
      sha: SHA,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });

    assert.equal(result.status, "neutral");
    assert.match(result.message, /superseded/);
  });

  it("the production path reports FAILURE for the same deployment", async () => {
    const { fetchImpl } = makeFetchStub([okJson(cancelledOnMain)]);

    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_cancelled",
      teamId: TEAM_ID,
      label: "frapp-web",
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });

    assert.equal(result.status, "failure");
    assert.match(result.message, /never a no-op/);
  });
});

describe("classifyVercelState", () => {
  it("READY is success", () => assert.equal(classifyVercelState("READY"), "success"));
  it("ERROR is failure", () => assert.equal(classifyVercelState("ERROR"), "failure"));
  it("CANCELED is failure, not neutral", () =>
    assert.equal(classifyVercelState("CANCELED"), "failure"));
  it("BUILDING is pending", () => assert.equal(classifyVercelState("BUILDING"), "pending"));
  it("an unrecognised state is pending, not success", () =>
    assert.equal(classifyVercelState("SOMETHING_NEW"), "pending"));
});

describe("createVercelProductionDeployment", () => {
  it("asks for target production from a git commit", async () => {
    const { fetchImpl, calls } = makeFetchStub([
      okJson({ id: "dpl_new", target: "production", url: "x.vercel.app" }),
    ]);

    const result = await createVercelProductionDeployment({
      apiKey: API_KEY,
      projectId: "prj_web",
      projectName: "frapp-web",
      sha: SHA,
      repoId: REPO_ID,
      teamId: TEAM_ID,
      fetchImpl,
    });

    assert.equal(result.deploymentId, "dpl_new");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.target, "production");
    assert.equal(body.gitSource.sha, SHA);
    // `ref` must stay a branch name. Passing the SHA here makes
    // meta.githubCommitRef a commit id, and every branch-scoped lookup misses.
    assert.equal(body.gitSource.ref, "main");
    assert.equal(body.gitSource.repoId, REPO_ID);
    assert.match(calls[0].url, /teamId=team_test/);
  });

  it("throws when Vercel returns a deployment that is NOT production", async () => {
    // A preview build reported as created would poll to READY and be announced
    // as a successful production deploy while production traffic never moved.
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_preview", target: null })]);

    await assert.rejects(
      () =>
        createVercelProductionDeployment({
          apiKey: API_KEY,
          projectId: "prj_web",
          projectName: "frapp-web",
          sha: SHA,
          repoId: REPO_ID,
          fetchImpl,
        }),
      /not 'production'/,
    );
  });

  it("throws when the create call is refused", async () => {
    const { fetchImpl } = makeFetchStub([errJson(403, { error: { message: "forbidden" } })]);
    await assert.rejects(
      () =>
        createVercelProductionDeployment({
          apiKey: API_KEY,
          projectId: "prj_web",
          projectName: "frapp-web",
          sha: SHA,
          repoId: REPO_ID,
          fetchImpl,
        }),
      /HTTP 403/,
    );
  });

  it("throws when Vercel accepts the request but returns no id", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ target: "production" })]);
    await assert.rejects(
      () =>
        createVercelProductionDeployment({
          apiKey: API_KEY,
          projectId: "prj_web",
          projectName: "frapp-web",
          sha: SHA,
          repoId: REPO_ID,
          fetchImpl,
        }),
      /returned no id/,
    );
  });
});

describe("pollVercelDeployment", () => {
  it("polls the deployment id, never the project's deployment list", async () => {
    const { fetchImpl, calls } = makeFetchStub([
      okJson({ id: "dpl_x", state: "BUILDING" }),
      okJson({ id: "dpl_x", state: "READY" }),
    ]);

    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_x",
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });

    assert.equal(result.status, "success");
    // The id in the path is what makes this immune to the preview/production
    // ambiguity: one SHA now has two deployments and a list scan can pick either.
    for (const call of calls) assert.match(call.url, /\/v13\/deployments\/dpl_x/);
  });

  it("fails on ERROR", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ state: "ERROR" })]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_x",
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });
    assert.equal(result.status, "failure");
  });

  it("fails on an API error rather than retrying forever", async () => {
    const { fetchImpl } = makeFetchStub([errJson(401)]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_x",
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.match(result.message, /HTTP 401/);
  });

  it("fails on timeout — never assumes a slow build went live", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ state: "BUILDING" })]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_x",
      clock: makeFakeClock(),
      fetchImpl,
      overallTimeoutMs: 60 * 1000,
      pollIntervalMs: 20 * 1000,
      logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.match(result.message, /Timed out/);
  });
});

describe("deployVercelProduction", () => {
  const projects = [
    { projectId: "prj_web", projectName: "frapp-web", label: "frapp-web" },
    { projectId: "prj_landing", projectName: "frapp-landing", label: "frapp-landing" },
  ];

  it("creates BOTH deployments before polling either", async () => {
    const order = [];
    const fetchImpl = async (url, options) => {
      if (options?.method === "POST") {
        order.push("create");
        const name = JSON.parse(options.body).name;
        return okJson({ id: `dpl_${name}`, target: "production" });
      }
      order.push("poll");
      return okJson({ state: "READY" });
    };

    const outcome = await deployVercelProduction({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      repoId: REPO_ID,
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, true);
    // Both creates land before any poll: on a Hobby plan the builds queue, and
    // create-poll-create-poll makes landing wait out web's entire build.
    assert.deepEqual(order.slice(0, 2), ["create", "create"]);
  });

  it("fails the whole deploy when landing fails and web succeeds", async () => {
    const fetchImpl = async (url, options) => {
      if (options?.method === "POST") {
        const name = JSON.parse(options.body).name;
        return okJson({ id: `dpl_${name}`, target: "production" });
      }
      return okJson({ state: url.includes("frapp-landing") ? "ERROR" : "READY" });
    };

    const outcome = await deployVercelProduction({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      repoId: REPO_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.failures.length, 1);
    assert.equal(outcome.failures[0].label, "frapp-landing");
  });

  it("reports a failed create as a failure rather than skipping the project", async () => {
    const fetchImpl = async (url, options) => {
      if (options?.method === "POST") return errJson(500);
      return okJson({ state: "READY" });
    };

    const outcome = await deployVercelProduction({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      repoId: REPO_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.failures.length, 2);
  });
});
