import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchJson, fetchRenderDeploys, fetchVercelDeployments } from "../lib/providers.mjs";

function recorder(response) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response;
  };
  return { calls, fetchImpl };
}

const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body });

// The shared ok-check-throw-json wrapper `fetchRenderDeploys`,
// `fetchVercelDeployments`, and `production-guardrails.mjs` all built
// independently before this (#1351). This suite covers the wrapper itself;
// the two below cover only their URL-building and error-message wrapping.
describe("fetchJson", () => {
  it("returns the parsed JSON body on a 2xx response", async () => {
    const { calls, fetchImpl } = recorder(jsonOk({ hello: "world" }));
    const body = await fetchJson({
      url: "https://example.com/x",
      headers: { Authorization: "Bearer k" },
      what: "Example API",
      fetchImpl,
    });
    assert.deepEqual(body, { hello: "world" });
    assert.equal(calls[0].url, "https://example.com/x");
    assert.equal(calls[0].init.headers.Authorization, "Bearer k");
  });

  it("throws naming `what` and the status on a non-ok response", async () => {
    const { fetchImpl } = recorder({ ok: false, status: 404, json: async () => ({}) });
    await assert.rejects(
      () => fetchJson({ url: "https://example.com/x", headers: {}, what: "Example API", fetchImpl }),
      /Example API returned HTTP 404/,
    );
  });
});

describe("fetchRenderDeploys", () => {
  it("asks for the service's deploys and returns the parsed body", async () => {
    const { calls, fetchImpl } = recorder(jsonOk([{ deploy: { id: "d1" } }]));
    const body = await fetchRenderDeploys({ apiKey: "k", serviceId: "srv-1", fetchImpl });
    assert.deepEqual(body, [{ deploy: { id: "d1" } }]);
    assert.ok(calls[0].url.startsWith("https://api.render.com/v1/services/srv-1/deploys"));
  });

  it("authenticates with a bearer token", async () => {
    const { calls, fetchImpl } = recorder(jsonOk([]));
    await fetchRenderDeploys({ apiKey: "k", serviceId: "srv-1", fetchImpl });
    assert.equal(calls[0].init.headers.Authorization, "Bearer k");
  });

  // Naming the service in the error is what makes a red deploy log actionable
  // rather than a bare status code.
  it("throws naming the service and the status on a non-ok response", async () => {
    const { fetchImpl } = recorder({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(
      () => fetchRenderDeploys({ apiKey: "k", serviceId: "srv-1", fetchImpl }),
      /Render API for service srv-1 returned HTTP 503/,
    );
  });
});

describe("fetchVercelDeployments", () => {
  it("asks for the project's deployments and returns the parsed body", async () => {
    const { calls, fetchImpl } = recorder(jsonOk({ deployments: [{ uid: "dpl_1" }] }));
    const body = await fetchVercelDeployments({ apiKey: "k", projectId: "prj_1", fetchImpl });
    assert.deepEqual(body, { deployments: [{ uid: "dpl_1" }] });
    assert.ok(calls[0].url.includes("projectId=prj_1"));
  });

  it("authenticates with a bearer token", async () => {
    const { calls, fetchImpl } = recorder(jsonOk({ deployments: [] }));
    await fetchVercelDeployments({ apiKey: "k", projectId: "prj_1", fetchImpl });
    assert.equal(calls[0].init.headers.Authorization, "Bearer k");
  });

  it("throws naming the project and the status on a non-ok response", async () => {
    const { fetchImpl } = recorder({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(
      () => fetchVercelDeployments({ apiKey: "k", projectId: "prj_1", fetchImpl }),
      /Vercel API for project prj_1 returned HTTP 401/,
    );
  });
});
