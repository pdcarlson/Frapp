import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchRenderDeploys, fetchVercelDeployments } from "../lib/providers.mjs";

function recorder(response) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response;
  };
  return { calls, fetchImpl };
}

const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body });

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
  it("throws naming the status and the service on a non-ok response", async () => {
    const { fetchImpl } = recorder({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(
      () => fetchRenderDeploys({ apiKey: "k", serviceId: "srv-1", fetchImpl }),
      /Render API returned HTTP 503 for service srv-1/,
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

  it("throws naming the status and the project on a non-ok response", async () => {
    const { fetchImpl } = recorder({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(
      () => fetchVercelDeployments({ apiKey: "k", projectId: "prj_1", fetchImpl }),
      /Vercel API returned HTTP 401 for project prj_1/,
    );
  });
});
