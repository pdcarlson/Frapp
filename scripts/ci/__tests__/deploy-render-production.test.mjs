import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyRenderStatus,
  createRenderDeploy,
  deployRenderCommit,
  resolveImageUrl,
  pollRenderDeploy,
  RENDER_MAX_CONSECUTIVE_READ_ERRORS,
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

  // Superseded deploys. Every caller holds a single-concurrency lock and creates
  // exactly one deploy on a service that does not auto-deploy, so nothing of
  // ours supersedes it: a cancel means the commit did not ship.
  it("canceled is a failure — the commit did not ship", () =>
    assert.equal(classifyRenderStatus("canceled"), "failure"));
  it("deactivated is a failure — the commit is not serving", () =>
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

describe("an image-backed service (#2506)", () => {
  const API_IMAGE = "ghcr.io/frapplive/frapp-api";
  const DIGEST = `sha256:${"0123456789abcdef".repeat(4)}`;
  const IMAGE = `${API_IMAGE}@${DIGEST}`;

  it("sends the image, not the commit", async () => {
    const { fetchImpl, calls } = makeFetchStub([okJson({ id: "dep-img" })]);
    const result = await createRenderDeploy({ apiKey: API_KEY, serviceId: SERVICE_ID, sha: SHA, imageUrl: IMAGE, fetchImpl });
    assert.equal(result.deployId, "dep-img");
    assert.deepEqual(JSON.parse(calls[0].options.body), { imageUrl: IMAGE });
  });

  it("deploys by commit unless the environment says image", () => {
    assert.equal(resolveImageUrl({}), null);
    assert.equal(resolveImageUrl({ deploySource: "commit", imageRef: IMAGE, apiImage: API_IMAGE }), null);
    assert.equal(resolveImageUrl({ deploySource: "image", imageRef: IMAGE, apiImage: API_IMAGE }), IMAGE);
  });

  it("refuses a missing or malformed reference, a tag, and another repository", () => {
    for (const [label, imageRef, pattern] of [
      ["missing", "", /did not hand one over/],
      ["a commit tag, which can be pushed again", `${API_IMAGE}:${SHA}`, /@sha256:<digest>/],
      ["a moving tag", `${API_IMAGE}:latest`, /@sha256:<digest>/],
      ["a short digest", `${API_IMAGE}@sha256:abc`, /@sha256:<digest>/],
      ["another registry", `docker.io/frapplive/frapp-api@${DIGEST}`, /@sha256:<digest>/],
      ["another repository", `ghcr.io/frapplive/other@${DIGEST}`, /not the configured apiImage/],
    ]) {
      assert.throws(() => resolveImageUrl({ deploySource: "image", imageRef, apiImage: API_IMAGE }), pattern, label);
    }
    assert.throws(() => resolveImageUrl({ deploySource: "image", imageRef: IMAGE }), /not the configured apiImage ''/);
    assert.throws(() => resolveImageUrl({ deploySource: "docker" }), /commit or image/);
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

  // A failure pages (staging) or fails a release (production), so a read that
  // outlasts resilientFetch's own retries is re-asked, not a verdict.
  it("re-asks after a transient 502 and passes when the deploy goes live", async () => {
    const { fetchImpl, calls } = makeFetchStub([errJson(502), okJson({ status: "live" })]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "success");
    assert.equal(calls.length, 2);
  });

  it("re-asks after a thrown read (network error) instead of dying unhandled", async () => {
    const { fetchImpl } = makeFetchStub([
      () => { throw new Error("ECONNRESET"); },
      okJson({ status: "live" }),
    ]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "success");
  });

  it("re-asks after a body that fails to parse", async () => {
    const badBody = { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end"); } };
    const { fetchImpl } = makeFetchStub([badBody, okJson({ status: "live" })]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "success");
  });

  it("fails after RENDER_MAX_CONSECUTIVE_READ_ERRORS failed reads in a row", async () => {
    const { fetchImpl, calls } = makeFetchStub([errJson(502)]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.equal(calls.length, RENDER_MAX_CONSECUTIVE_READ_ERRORS);
    assert.match(result.message, /HTTP 502/);
  });

  it("resets the count after a good read", async () => {
    const { fetchImpl } = makeFetchStub([
      errJson(502), errJson(502), okJson({ status: "build_in_progress" }),
      errJson(502), errJson(502), okJson({ status: "live" }),
    ]);
    const result = await pollRenderDeploy({
      apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "success");
  });

  it("fails at once on a 403 or 404: re-asking can't fix a key or an id", async () => {
    for (const status of [403, 404]) {
      const { fetchImpl, calls } = makeFetchStub([errJson(status)]);
      const result = await pollRenderDeploy({
        apiKey: API_KEY, serviceId: SERVICE_ID, deployId: "dep-1",
        clock: makeFakeClock(), fetchImpl, logger: quiet,
      });
      assert.equal(result.status, "failure", `HTTP ${status}`);
      assert.equal(calls.length, 1, `HTTP ${status} is not re-asked`);
    }
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

describe("deployRenderCommit", () => {
  it("returns the created deploy id alongside the verdict", async () => {
    const fetchImpl = async (url, options) =>
      options?.method === "POST" ? okJson({ id: "dep-9" }) : okJson({ status: "live" });

    const result = await deployRenderCommit({
      apiKey: API_KEY, serviceId: SERVICE_ID, sha: SHA,
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });

    assert.equal(result.status, "success");
    assert.equal(result.deployId, "dep-9");
  });

  it("surfaces a failed create as a failure, not a throw", async () => {
    const fetchImpl = async () => errJson(403, "forbidden");
    const result = await deployRenderCommit({
      apiKey: API_KEY, serviceId: SERVICE_ID, sha: SHA,
      clock: makeFakeClock(), fetchImpl, logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.equal(result.deployId, null);
  });
});
