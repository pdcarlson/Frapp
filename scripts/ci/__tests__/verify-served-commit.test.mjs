import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isSameCommit,
  readyUrlFor,
  verifyServedCommit,
} from "../verify-served-commit.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OLD_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const HEALTH_URL = "https://api-staging.example.com/health";
const quiet = { log: () => {} };

function makeFakeClock() {
  let nowMs = 1_000_000;
  return { now: () => nowMs, sleep: async (ms) => { nowMs += ms; } };
}

function health(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  };
}

function makeFetchStub(responses) {
  let index = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const handler = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (handler instanceof Error) throw handler;
    return typeof handler === "function" ? handler() : handler;
  };
  return { fetchImpl, calls };
}

function run(responses, overrides = {}) {
  const { fetchImpl, calls } = makeFetchStub(responses);
  const result = verifyServedCommit({
    healthUrl: HEALTH_URL,
    sha: SHA,
    label: "frapp-api-staging",
    clock: makeFakeClock(),
    fetchImpl,
    pollIntervalMs: 10_000,
    overallTimeoutMs: 60_000,
    logger: quiet,
    ...overrides,
  });
  return { result, calls };
}

describe("readyUrlFor", () => {
  it("appends /ready to the stored /health URL", () =>
    assert.equal(readyUrlFor(HEALTH_URL), `${HEALTH_URL}/ready`));
  it("tolerates a trailing slash", () =>
    assert.equal(readyUrlFor(`${HEALTH_URL}/`), `${HEALTH_URL}/ready`));
});

describe("isSameCommit", () => {
  it("matches the same SHA in either case", () => assert.ok(isSameCommit(SHA.toUpperCase(), SHA)));
  it("rejects a different SHA", () => assert.equal(isSameCommit(OLD_SHA, SHA), false));
  it("rejects a missing commit", () => {
    assert.equal(isSameCommit(null, SHA), false);
    assert.equal(isSameCommit(undefined, SHA), false);
  });
  // A prefix is not the commit: `/health` reports Render's full SHA, so a short
  // one means something other than the service this job deployed answered.
  it("rejects an abbreviated SHA", () => assert.equal(isSameCommit(SHA.slice(0, 7), SHA), false));
});

describe("verifyServedCommit", () => {
  it("polls /health/ready, not /health", async () => {
    const { result, calls } = run([health(200, { status: "ok", commit: SHA })]);
    assert.equal((await result).status, "success");
    assert.equal(calls[0].url, `${HEALTH_URL}/ready`);
  });

  // The defect this replaces: the old loop passed on any 2xx, which the old
  // instance gives while the new one is still switching in.
  it("keeps polling while the OLD commit answers ready, then passes on the new one", async () => {
    const { result, calls } = run([
      health(200, { status: "ok", commit: OLD_SHA }),
      health(200, { status: "ok", commit: OLD_SHA }),
      health(200, { status: "ok", commit: SHA }),
    ]);
    assert.equal((await result).status, "success");
    assert.equal(calls.length, 3);
  });

  it("fails when the old commit is still answering at the deadline, and names it", async () => {
    const { result } = run([health(200, { status: "ok", commit: OLD_SHA })]);
    const verdict = await result;
    assert.equal(verdict.status, "failure");
    assert.match(verdict.message, new RegExp(`commit ${OLD_SHA}`));
    assert.match(verdict.message, /never took traffic/);
  });

  it("does not pass the right commit while it is not ready", async () => {
    const { result } = run([health(503, { statusCode: 503, message: "degraded" })]);
    const verdict = await result;
    assert.equal(verdict.status, "failure");
    assert.match(verdict.message, /HTTP 503/);
  });

  it("passes once the right commit becomes ready", async () => {
    const { result } = run([health(503, undefined), health(200, { status: "ok", commit: SHA })]);
    assert.equal((await result).status, "success");
  });

  it("never passes a 2xx that carries no commit", async () => {
    const { result } = run([health(200, { status: "ok" })]);
    const verdict = await result;
    assert.equal(verdict.status, "failure");
    assert.match(verdict.message, /no commit field/);
  });

  it("treats a thrown request as not-yet, and reports it at the deadline", async () => {
    const { result, calls } = run([new Error("ECONNRESET")]);
    const verdict = await result;
    assert.equal(verdict.status, "failure");
    assert.match(verdict.message, /request failed \(ECONNRESET\)/);
    assert.ok(calls.length > 1, "a failed request is re-asked, not a verdict");
  });

  it("recovers from a thrown request (a cold start dropping the connection)", async () => {
    const { result } = run([new Error("socket hang up"), health(200, { status: "ok", commit: SHA })]);
    assert.equal((await result).status, "success");
  });
});

// A missing API_HEALTHCHECK_URL must fail the deploy (it used to warn and exit
// 0, which reads the same as a pass). That lives in main(), so run the CLI.
describe("CLI", () => {
  it("exits 1 when API_HEALTHCHECK_URL is missing", async () => {
    const { spawnSync } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const script = fileURLToPath(new URL("../verify-served-commit.mjs", import.meta.url));
    const env = { ...process.env, DEPLOY_SHA: SHA };
    delete env.API_HEALTHCHECK_URL;
    const run = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr + run.stdout, /API_HEALTHCHECK_URL/);
  });
});
