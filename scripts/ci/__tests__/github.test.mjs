import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ghGetWithFallback, ghRequest, githubHeaders, GITHUB_API } from "../lib/github.mjs";

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

  // #2333: a call without `retry` used to be a bare fetch with no deadline, so
  // an API that accepted the connection and never answered held the watchdog
  // until undici's ~300s header timeout.
  it("bounds a call made without retry", async () => {
    const { calls, fetchImpl } = recorder(() => ok({}));
    await ghRequest({ token: "t", path: "/x", fetchImpl });
    await ghRequest({ token: "t", path: "/x", method: "POST", body: { a: 1 }, fetchImpl });
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.ok(calls[1].init.signal instanceof AbortSignal);
  });

  // Settles only when the request's own signal aborts. With no signal it never
  // settles, so an unbounded call fails the test on its timeout instead of
  // passing on a TypeError.
  function hangsUntilAborted(signal) {
    return new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }

  it("turns a call that never answers into ok:false status:0, once, within its timeout", { timeout: 2000 }, async () => {
    const { calls, fetchImpl } = recorder((_n, init) => hangsUntilAborted(init.signal));
    const result = await ghRequest({
      token: "t",
      path: "/x",
      fetchImpl,
      retryOptions: { timeoutMs: 20 },
    });
    assert.equal(calls.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.data, /timeout|aborted/i);
  });

  it("turns a body that stalls after the headers into ok:false status:0", { timeout: 2000 }, async () => {
    const { fetchImpl } = recorder((_n, init) => ({
      ok: true,
      status: 200,
      text: () => hangsUntilAborted(init.signal),
    }));
    const result = await ghRequest({
      token: "t",
      path: "/x",
      fetchImpl,
      retryOptions: { timeoutMs: 20 },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.data, /timeout|aborted/i);
  });

  it("keeps a caller's `attempts` from turning retry on", async () => {
    const { calls, fetchImpl } = recorder(() => ({ ok: false, status: 503, text: async () => "" }));
    await ghRequest({
      token: "t",
      path: "/x",
      fetchImpl,
      retryOptions: { attempts: 3, sleep: async () => {} },
    });
    assert.equal(calls.length, 1);
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

describe("ghGetWithFallback", () => {
  const status = (code) => ({ ok: code < 300, status: code, text: async () => "{}" });
  const tokenOf = (call) => call.init.headers.Authorization.replace("Bearer ", "");
  const read = (fetchImpl, fallbackToken = "pat") =>
    ghGetWithFallback({
      token: "tok",
      fallbackToken,
      fetchImpl,
      path: "/x",
      retryOptions: { sleep: async () => {} },
    });

  it("retries a 5xx on the same token and never falls back for it", async () => {
    const { calls, fetchImpl } = recorder((n) => (n < 3 ? status(502) : ok({})));
    const result = await read(fetchImpl);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map(tokenOf), ["tok", "tok", "tok"]);
  });

  it("never re-sends a 5xx that outlasts its retries with the fallback token", async () => {
    const { calls, fetchImpl } = recorder(() => status(502));
    const result = await read(fetchImpl);
    assert.equal(result.status, 502);
    assert.deepEqual(calls.map(tokenOf), ["tok", "tok", "tok"]);
  });

  it("falls back on a 401 or 403 only when the fallback token differs", async () => {
    for (const refused of [401, 403]) {
      const { calls, fetchImpl } = recorder((n) => (n === 1 ? status(refused) : ok({})));
      assert.equal((await read(fetchImpl)).ok, true);
      assert.deepEqual(calls.map(tokenOf), ["tok", "pat"]);
    }
    const { calls, fetchImpl } = recorder(() => status(401));
    assert.equal((await read(fetchImpl, "tok")).status, 401);
    assert.equal(calls.length, 1);
  });

  it("retries the fallback read too", async () => {
    const { calls, fetchImpl } = recorder((n) => (n === 1 ? status(403) : n === 2 ? status(500) : ok({})));
    const result = await read(fetchImpl);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map(tokenOf), ["tok", "pat", "pat"]);
  });
});
