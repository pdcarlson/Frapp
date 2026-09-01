import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ghRequest, githubHeaders, GITHUB_API } from "../lib/github.mjs";

function recorder(responder) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return responder(calls.length, init);
  };
  return { calls, fetchImpl };
}

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

describe("githubHeaders", () => {
  it("sends the three headers every hand-rolled client was sending", () => {
    const h = githubHeaders({ token: "t" });
    assert.equal(h.Authorization, "Bearer t");
    assert.equal(h.Accept, "application/vnd.github+json");
    assert.equal(h["X-GitHub-Api-Version"], "2022-11-28");
    assert.equal(h["Content-Type"], undefined);
  });

  it("adds Content-Type only when there is a body", () => {
    assert.equal(githubHeaders({ token: "t", hasBody: true })["Content-Type"], "application/json");
  });
});

describe("ghRequest", () => {
  it("resolves the path against the GitHub API host", async () => {
    const { calls, fetchImpl } = recorder(() => ok({}));
    await ghRequest({ token: "t", path: "/repos/a/b", fetchImpl });
    assert.equal(calls[0].url, `${GITHUB_API}/repos/a/b`);
  });

  it("parses a JSON body", async () => {
    const { fetchImpl } = recorder(() => ok({ number: 7 }));
    const { ok: okFlag, status, data } = await ghRequest({ token: "t", path: "/x", fetchImpl });
    assert.equal(okFlag, true);
    assert.equal(status, 200);
    assert.deepEqual(data, { number: 7 });
  });

  it("falls back to raw text when the body is not JSON", async () => {
    const { fetchImpl } = recorder(() => ({ ok: true, status: 200, text: async () => "plain" }));
    const { data } = await ghRequest({ token: "t", path: "/x", fetchImpl });
    assert.equal(data, "plain");
  });

  it("returns null data for an empty body", async () => {
    const { fetchImpl } = recorder(() => ({ ok: true, status: 204, text: async () => "" }));
    const { data, status } = await ghRequest({ token: "t", path: "/x", fetchImpl });
    assert.equal(data, null);
    assert.equal(status, 204);
  });

  // The fail-safe contract both watchdogs depend on. An uncaught throw used to
  // abort the whole run — for pr-base-sync that dropped every PR after the
  // failing one and turned a transient socket blip into a red run on main.
  it("converts a network rejection into ok:false status:0 rather than throwing", async () => {
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    assert.deepEqual(await ghRequest({ token: "t", path: "/x", fetchImpl }), {
      ok: false,
      status: 0,
      data: "ECONNRESET",
    });
  });

  // A throwing caller (`fetchPrLabels`, `fetchCheckRuns`, `callGitHubApi`) puts
  // `data` straight into its thrown message. Losing the original error text
  // here means every network outage reads as the identical, uninformative
  // "HTTP 0" or "failed (0): null" regardless of what actually went wrong.
  it("preserves the rejection's message when the caller has no `.message`", async () => {
    const fetchImpl = async () => {
      // eslint-disable-next-line no-throw-literal
      throw "ECONNRESET";
    };
    const result = await ghRequest({ token: "t", path: "/x", fetchImpl });
    assert.equal(result.data, null);
  });

  it("serialises a body and marks the method", async () => {
    const { calls, fetchImpl } = recorder(() => ok({}));
    await ghRequest({ token: "t", path: "/x", method: "POST", body: { a: 1 }, fetchImpl });
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, JSON.stringify({ a: 1 }));
  });

  // Retry is OFF by default on purpose: the watchdog suites assert exact call
  // counts against 5xx fixtures ("exactly one API call: the freshness check"),
  // and a default retry would silently change them.
  it("does not retry by default", async () => {
    const { calls, fetchImpl } = recorder(() => ({ ok: false, status: 503, text: async () => "" }));
    const { ok: okFlag, status } = await ghRequest({ token: "t", path: "/x", fetchImpl });
    assert.equal(calls.length, 1);
    assert.equal(okFlag, false);
    assert.equal(status, 503);
  });

  // undici leaves `message` as the bare "fetch failed" and hangs the actual
  // diagnosis on `.cause`. Dropping it made a DNS outage, a TLS/CA-bundle
  // rejection, a proxy reset and a refused connection all reach the operator as
  // the same four words - and `configure-branch-protection.mjs --verify` asks
  // them to tell exactly those apart (#1383).
  it("folds a transport error's cause into `data`", async () => {
    const fetchImpl = async () => {
      const error = new TypeError("fetch failed");
      error.cause = Object.assign(new Error("getaddrinfo ENOTFOUND api.github.com"), {
        code: "ENOTFOUND",
      });
      throw error;
    };
    const { data, status } = await ghRequest({ token: "t", path: "/x", fetchImpl });
    assert.equal(status, 0);
    assert.equal(data, "fetch failed: getaddrinfo ENOTFOUND api.github.com (ENOTFOUND)");
  });

  it("leaves a causeless error's message untouched", async () => {
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    const { data } = await ghRequest({ token: "t", path: "/x", fetchImpl });
    assert.equal(data, "ECONNRESET");
  });

  it("retries when the caller opts in", async () => {
    const { calls, fetchImpl } = recorder((n) =>
      n < 3 ? { ok: false, status: 503, text: async () => "" } : ok({ done: true }),
    );
    const { data } = await ghRequest({
      token: "t",
      path: "/x",
      fetchImpl,
      retry: true,
      retryOptions: { sleep: async () => {} },
    });
    assert.equal(calls.length, 3);
    assert.deepEqual(data, { done: true });
  });
});
