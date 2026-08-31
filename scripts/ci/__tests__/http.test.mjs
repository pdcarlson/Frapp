import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchWithRetry,
  isRetriableStatus,
  resilientFetch,
  IDEMPOTENT_METHODS,
  DEFAULT_ATTEMPTS,
} from "../lib/http.mjs";

/** Replays a scripted sequence of statuses; "throw" rejects like undici does. */
function scripted(sequence) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    const next = sequence[i] ?? sequence.at(-1);
    i += 1;
    if (next === "throw") throw new Error("ECONNRESET");
    return { ok: next < 400, status: next, text: async () => "" };
  };
  return { calls, fetchImpl };
}

const noSleep = async () => {};

describe("isRetriableStatus", () => {
  it("treats 429 and 5xx as transport failures", () => {
    for (const s of [429, 500, 502, 503, 599]) assert.equal(isRetriableStatus(s), true);
  });

  // A 401/403/404 on a deploy path is a dead token or a wrong id. Re-sending it
  // converts a clear failure into a slow one.
  it("does not retry other 4xx", () => {
    for (const s of [400, 401, 403, 404, 422]) assert.equal(isRetriableStatus(s), false);
  });
});

describe("fetchWithRetry", () => {
  it("retries a 5xx and returns the eventual success", async () => {
    const { calls, fetchImpl } = scripted([500, 500, 200]);
    const res = await fetchWithRetry("u", {}, { fetchImpl, sleep: noSleep });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 3);
  });

  it("retries a network rejection", async () => {
    const { calls, fetchImpl } = scripted(["throw", 200]);
    const res = await fetchWithRetry("u", {}, { fetchImpl, sleep: noSleep });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
  });

  it("returns a non-retriable response on the first attempt", async () => {
    const { calls, fetchImpl } = scripted([404]);
    const res = await fetchWithRetry("u", {}, { fetchImpl, sleep: noSleep });
    assert.equal(res.status, 404);
    assert.equal(calls.length, 1);
  });

  it("returns the last response when every attempt is retriable", async () => {
    const { calls, fetchImpl } = scripted([503, 503, 503]);
    const res = await fetchWithRetry("u", {}, { fetchImpl, sleep: noSleep });
    assert.equal(res.status, 503);
    assert.equal(calls.length, DEFAULT_ATTEMPTS);
  });

  // The original cause has to survive to the log; inventing a new Error here
  // would erase the DNS/socket detail that explains the failure.
  it("rethrows the last error when every attempt threw", async () => {
    const { calls, fetchImpl } = scripted(["throw", "throw", "throw"]);
    await assert.rejects(
      () => fetchWithRetry("u", {}, { fetchImpl, sleep: noSleep }),
      /ECONNRESET/,
    );
    assert.equal(calls.length, DEFAULT_ATTEMPTS);
  });

  // The load-bearing safety property: creating a Render or Vercel deployment is
  // a POST, and re-sending it after a lost response starts a SECOND production
  // deploy.
  it("never retries a non-idempotent method", async () => {
    const { calls, fetchImpl } = scripted([503, 503, 200]);
    const res = await fetchWithRetry("u", { method: "POST" }, { fetchImpl, sleep: noSleep });
    assert.equal(calls.length, 1, "a create must be sent exactly once");
    assert.equal(res.status, 503);
  });

  it("lets a caller opt a known-idempotent POST into retry", async () => {
    const { calls, fetchImpl } = scripted([503, 200]);
    const res = await fetchWithRetry(
      "u",
      { method: "POST" },
      { fetchImpl, sleep: noSleep, retryMethods: new Set(["POST"]) },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
  });

  it("honours a caller's abort rather than retrying it", async () => {
    const controller = new AbortController();
    controller.abort();
    const { calls, fetchImpl } = scripted(["throw"]);
    await assert.rejects(() =>
      fetchWithRetry("u", { signal: controller.signal }, { fetchImpl, sleep: noSleep }),
    );
    assert.equal(calls.length, 1);
  });

  it("backs off between attempts", async () => {
    const slept = [];
    const { fetchImpl } = scripted([500, 500, 200]);
    await fetchWithRetry("u", {}, { fetchImpl, sleep: async (ms) => slept.push(ms) });
    assert.deepEqual(slept, [1000, 5000]);
  });

  it("reports each retry to onRetry", async () => {
    const seen = [];
    const { fetchImpl } = scripted([500, 200]);
    await fetchWithRetry("u", {}, { fetchImpl, sleep: noSleep, onRetry: (i) => seen.push(i.status) });
    assert.deepEqual(seen, [500]);
  });
});

describe("resilientFetch", () => {
  it("is a drop-in fetch carrying the defaults", () => {
    assert.equal(typeof resilientFetch, "function");
    assert.equal(resilientFetch.length, 2);
  });

  it("scopes retry to the idempotent methods", () => {
    assert.ok(IDEMPOTENT_METHODS.has("GET"));
    assert.ok(!IDEMPOTENT_METHODS.has("POST"));
    assert.ok(!IDEMPOTENT_METHODS.has("DELETE"));
  });
});
