import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchJson,
  fetchRenderDeploys,
  fetchVercelDeployments,
  findRenderDeployBySha,
  findVercelDeploymentBySha,
} from "../lib/providers.mjs";

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

  it("passes `cursor` through as the pagination param", async () => {
    const { calls, fetchImpl } = recorder(jsonOk([]));
    await fetchRenderDeploys({ apiKey: "k", serviceId: "srv-1", cursor: "cur-abc", fetchImpl });
    assert.match(calls[0].url, /cursor=cur-abc/);
  });
});

// Same class of bug as the Vercel finder above (#1377): Render's list is also
// a single un-paginated page.
describe("findRenderDeployBySha", () => {
  function page(entries) {
    return jsonOk(entries);
  }

  it("finds a match on the first page without paginating further", async () => {
    const { calls, fetchImpl } = recorder(
      page([{ cursor: "c1", deploy: { commit: { id: "sha1" }, createdAt: "2026-04-16T00:00:00Z" } }]),
    );
    const result = await findRenderDeployBySha({ apiKey: "k", serviceId: "srv-1", sha: "sha1", fetchImpl });
    assert.ok(result.match);
    assert.equal(result.pagesSearched, 1);
    assert.equal(calls.length, 1);
  });

  it("follows the row cursor to a later page and finds the match there", async () => {
    let callIndex = 0;
    const responses = [
      page([{ cursor: "c1", deploy: { commit: { id: "other" }, createdAt: "2026-04-16T01:00:00Z" } }]),
      page([{ cursor: "c2", deploy: { commit: { id: "sha1" }, createdAt: "2026-04-15T00:00:00Z" } }]),
    ];
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return responses[callIndex++];
    };

    const result = await findRenderDeployBySha({ apiKey: "k", serviceId: "srv-1", sha: "sha1", fetchImpl });

    assert.ok(result.match);
    assert.equal(result.pagesSearched, 2);
    assert.match(calls[1], /cursor=c1/);
  });

  it("reports exhausted when the last page has no cursor and no match", async () => {
    const { fetchImpl } = recorder(
      page([{ deploy: { commit: { id: "other" }, createdAt: "2026-04-16T00:00:00Z" } }]),
    );
    const result = await findRenderDeployBySha({ apiKey: "k", serviceId: "srv-1", sha: "sha1", fetchImpl });
    assert.equal(result.match, null);
    assert.equal(result.exhausted, true);
  });

  it("throws rather than treating a malformed page as empty", async () => {
    const { fetchImpl } = recorder(jsonOk({ notAnArray: true }));
    await assert.rejects(
      () => findRenderDeployBySha({ apiKey: "k", serviceId: "srv-1", sha: "sha1", fetchImpl }),
      /unexpected payload/,
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

  it("passes `until` through as the pagination cursor", async () => {
    const { calls, fetchImpl } = recorder(jsonOk({ deployments: [] }));
    await fetchVercelDeployments({ apiKey: "k", projectId: "prj_1", until: 1700000000000, fetchImpl });
    assert.match(calls[0].url, /until=1700000000000/);
  });
});

// The class #1377 exists to fix: a single un-paginated page only holds the
// newest slice, so a re-run against an old SHA reads "no deployment exists"
// once enough newer deployments have pushed it off page one.
describe("findVercelDeploymentBySha", () => {
  function page(deployments, next) {
    return jsonOk({ deployments, pagination: next ? { next } : {} });
  }

  it("finds a match on the first page without paginating further", async () => {
    const { calls, fetchImpl } = recorder(page([{ meta: { githubCommitSha: "sha1" }, created: 100 }]));
    const result = await findVercelDeploymentBySha({ apiKey: "k", projectId: "prj_1", sha: "sha1", fetchImpl });
    assert.equal(result.matches.length, 1);
    assert.equal(result.pagesSearched, 1);
    assert.equal(calls.length, 1);
  });

  // The exact failure scenario in #1377: the SHA's deployment fell off page
  // one, and is only visible after following the cursor to page two.
  it("follows the cursor to a later page and finds the match there", async () => {
    let callIndex = 0;
    const responses = [
      page([{ meta: { githubCommitSha: "other" }, created: 200 }], 100),
      page([{ meta: { githubCommitSha: "sha1" }, created: 50 }]),
    ];
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return responses[callIndex++];
    };

    const result = await findVercelDeploymentBySha({ apiKey: "k", projectId: "prj_1", sha: "sha1", fetchImpl });

    assert.equal(result.matches.length, 1);
    assert.equal(result.pagesSearched, 2);
    assert.match(calls[1], /until=100/);
  });

  it("reports exhausted when pagination runs out with no match", async () => {
    const { fetchImpl } = recorder(page([{ meta: { githubCommitSha: "other" }, created: 100 }]));
    const result = await findVercelDeploymentBySha({ apiKey: "k", projectId: "prj_1", sha: "sha1", fetchImpl });
    assert.equal(result.matches.length, 0);
    assert.equal(result.exhausted, true);
    assert.equal(result.pagesSearched, 1);
    assert.equal(result.oldestSeenMs, 100);
  });

  // A malformed page must not read as "zero deployments here" — that would
  // silently trip the exhaustion check and report a false "genuinely
  // absent" verdict instead of an honest "could not read".
  it("throws rather than treating a malformed page as empty", async () => {
    const { fetchImpl } = recorder(jsonOk({ notDeployments: [] }));
    await assert.rejects(
      () => findVercelDeploymentBySha({ apiKey: "k", projectId: "prj_1", sha: "sha1", fetchImpl }),
      /unexpected payload/,
    );
  });

  it("stops at maxPages, not exhausted, when the cursor still has more history", async () => {
    let callIndex = 0;
    const fetchImpl = async () => {
      callIndex += 1;
      return page([{ meta: { githubCommitSha: "other" }, created: 1000 - callIndex }], callIndex);
    };
    const result = await findVercelDeploymentBySha({
      apiKey: "k",
      projectId: "prj_1",
      sha: "sha1",
      maxPages: 3,
      fetchImpl,
    });
    assert.equal(result.matches.length, 0);
    assert.equal(result.pagesSearched, 3);
    assert.equal(result.exhausted, false);
  });
});
