import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyRenderStatus,
  createRenderDeploy,
  deployRenderProduction,
  pollRenderDeploy,
} from "../deploy-render-production.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SERVICE_ID = "srv-test";
const API_KEY = "test-key";
const quiet = { log: () => {} };

function makeFakeClock() {
  let nowMs = 1_000_000;
  return { now: () => nowMs, sleep: async (ms) => { nowMs += ms; } };
}

function okJson(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function errJson(status, text = "") {
  return { ok: false, status, json: async () => ({}), text: async () => text };
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

describe("classifyRenderStatus", () => {
  it("live is success", () => assert.equal(classifyRenderStatus("live"), "success"));
  it("build_failed is failure", () => assert.equal(classifyRenderStatus("build_failed"), "failure"));
  it("update_failed is failure", () => assert.equal(classifyRenderStatus("update_failed"), "failure"));
  it("pre_deploy_failed is failure", () =>
    assert.equal(classifyRenderStatus("pre_deploy_failed"), "failure"));

  // The observer calls these neutral because a newer push supersedes an older
  // deploy. This path holds a single-concurrency lock and creates exactly one
  // deploy, so there is no newer push: a cancel means the commit did not ship.
  it("canceled is a FAILURE here, unlike the observer", () =>
    assert.equal(classifyRenderStatus("canceled"), "failure"));
  it("deactivated is a FAILURE here, unlike the observer", () =>
    assert.equal(classifyRenderStatus("deactivated"), "failure"));

  it("build_in_progress is pending", () =>
    assert.equal(classifyRenderStatus("build_in_progress"), "pending"));
  it("an unrecognised status is pending, not success", () =>
    assert.equal(classifyRenderStatus("something_new"), "pending"));
});

describe("createRenderDeploy", () => {
  it("names the commit rather than relying on the branch tip", async () => {
    const { fetchImpl, calls } = makeFetchStub([okJson({ id: "dep-1", commit: { id: SHA } })]);

    const result = await createRenderDeploy({ apiKey: API_KEY, serviceId: SERVICE_ID, sha: SHA, fetchImpl });

    assert.equal(result.deployId, "dep-1");
    const body = JSON.parse(calls[0].options.body);
    // A deploy HOOK cannot express this: it builds whatever is at the tip of
    // the tracked branch, which now moves on every merge to main.
    assert.equal(body.commitId, SHA);
    assert.equal(calls[0].options.method, "POST");
  });

  it("throws with the response body when Render refuses", async () => {
    const { fetchImpl } = makeFetchStub([errJson(400, "commit not found")]);
    await assert.rejects(
      () => createRenderDeploy({ apiKey: API_KEY, serviceId: SERVICE_ID, sha: SHA, fetchImpl }),
      /HTTP 400.*commit not found/s,
    );
  });

  it("throws when Render accepts the request but returns no deploy id", async () => {
    const { fetchImpl } = makeFetchStub([okJson({})]);
    await assert.rejects(
      () => createRenderDeploy({ apiKey: API_KEY, serviceId: SERVICE_ID, sha: SHA, fetchImpl }),
      /returned no deploy id/,
    );
  });
});

describe("pollRenderDeploy", () => {
  it("polls the deploy id, so a re-dispatch of the same SHA is unambiguous", async () => {
    const { fetchImpl, calls } = makeFetchStub([
      okJson({ status: "build_in_progress" }),
      okJson({ status: "live" }),
    ]);

    const result = await pollRenderDeploy({
      apiKey: API_KEY,
      serviceId: SERVICE_ID,
      deployId: "dep-1",
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });

    assert.equal(result.status, "success");
    for (const call of calls) assert.match(call.url, /\/deploys\/dep-1$/);
  });

  it("fails on build_failed", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ status: "build_failed" })]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "failure");
  });

  it("fails on canceled — the commit did not ship", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ status: "canceled" })]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.match(result.message, /did not ship/);
  });

  it("fails on an API error", async () => {
    const { fetchImpl } = makeFetchStub([errJson(401)]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.match(result.message, /HTTP 401/);
  });

  it("fails on timeout rather than assuming it went live", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ status: "build_in_progress" })]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
      overallTimeoutMs: 60 * 1000, pollIntervalMs: 20 * 1000,
    });
    assert.equal(result.status, "failure");
    assert.match(result.message, /not an assumption that it went live/);
  });
});

describe("deployRenderProduction", () => {
  it("returns the created deploy id alongside the verdict", async () => {
    const fetchImpl = async (url, options) =>
      options?.method === "POST" ? okJson({ id: "dep-9" }) : okJson({ status: "live" });

    const result = await deployRenderProduction({
      apiKey: API_KEY, serviceId: SERVICE_ID, sha: SHA,
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });

    assert.equal(result.status, "success");
    assert.equal(result.deployId, "dep-9");
  });

  it("surfaces a failed create as a failure, not a throw", async () => {
    const fetchImpl = async () => errJson(403, "forbidden");
    const result = await deployRenderProduction({
      apiKey: API_KEY, serviceId: SERVICE_ID, sha: SHA,
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.equal(result.deployId, null);
  });
});
