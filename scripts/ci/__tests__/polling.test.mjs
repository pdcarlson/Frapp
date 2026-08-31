import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createClock, pollUntilTerminal } from "../lib/polling.mjs";

describe("createClock", () => {
  it("defaults to real Date.now and setTimeout-based sleep", async () => {
    const clock = createClock();
    assert.equal(typeof clock.now, "function");
    assert.equal(typeof clock.sleep, "function");
    const start = clock.now();
    await clock.sleep(1);
    assert.ok(clock.now() >= start);
  });

  it("accepts injected now and sleep for deterministic tests", async () => {
    let fakeNow = 1_000_000;
    const slept = [];
    const clock = createClock({
      now: () => fakeNow,
      sleep: async (ms) => {
        slept.push(ms);
        fakeNow += ms;
      },
    });

    assert.equal(clock.now(), 1_000_000);
    await clock.sleep(500);
    assert.deepEqual(slept, [500]);
    assert.equal(clock.now(), 1_000_500);
  });
});

// The shared skeleton behind verify-render-deploy.mjs, verify-vercel-deploy.mjs,
// deploy-render-production.mjs and deploy-vercel-production.mjs (#1351). Each
// of those files pins its own provider-specific classify/fetch behaviour in
// its own test file; this file only covers the loop mechanics pollUntilTerminal
// itself owns — deadline, sleep-between-attempts, and handing the timeout case
// to the caller.
describe("pollUntilTerminal", () => {
  function makeFakeClock() {
    let nowMs = 1_000_000;
    const slept = [];
    return {
      clock: {
        now: () => nowMs,
        sleep: async (ms) => {
          slept.push(ms);
          nowMs += ms;
        },
      },
      slept,
    };
  }

  it("returns immediately when classify terminates on the first attempt", async () => {
    const { clock, slept } = makeFakeClock();
    let fetchCount = 0;

    const result = await pollUntilTerminal({
      clock,
      pollIntervalMs: 1000,
      overallTimeoutMs: 60_000,
      fetchOne: async () => {
        fetchCount += 1;
        return { ready: true };
      },
      classify: (state) => (state.ready ? { status: "success", message: "done" } : null),
      onTimeout: () => ({ status: "failure", message: "should not be reached" }),
    });

    assert.deepEqual(result, { status: "success", message: "done" });
    assert.equal(fetchCount, 1);
    assert.deepEqual(slept, []);
  });

  it("sleeps pollIntervalMs between attempts while classify returns null", async () => {
    const { clock, slept } = makeFakeClock();
    let fetchCount = 0;

    const result = await pollUntilTerminal({
      clock,
      pollIntervalMs: 1000,
      overallTimeoutMs: 60_000,
      fetchOne: async () => {
        fetchCount += 1;
        return { ready: fetchCount >= 3 };
      },
      classify: (state) => (state.ready ? { status: "success", message: "ready" } : null),
      onTimeout: () => ({ status: "failure", message: "should not be reached" }),
    });

    assert.deepEqual(result, { status: "success", message: "ready" });
    assert.equal(fetchCount, 3);
    assert.deepEqual(slept, [1000, 1000]);
  });

  it("calls onTimeout with the last observed state once the deadline elapses", async () => {
    const { clock } = makeFakeClock();
    const observedStates = [];

    const result = await pollUntilTerminal({
      clock,
      pollIntervalMs: 1000,
      overallTimeoutMs: 3500,
      fetchOne: async () => "pending",
      classify: (state) => {
        observedStates.push(state);
        return null;
      },
      onTimeout: (lastState, elapsedMs) => ({
        status: "failure",
        message: `timed out after ${elapsedMs}ms, last state ${lastState}`,
      }),
    });

    // 3 attempts fit inside a 3500ms deadline at a 1000ms interval (0, 1000, 2000),
    // then the loop's while-condition fails at 3000 < 3500 → false after the 4th
    // sleep would push it to 4000, so it never fetches past elapsed >= 3500.
    assert.equal(observedStates.length, 4);
    assert.equal(result.status, "failure");
    assert.match(result.message, /timed out after 4000ms, last state pending/);
  });

  it("stops retrying immediately once classify returns a terminal result, without sleeping again", async () => {
    const { clock, slept } = makeFakeClock();

    await pollUntilTerminal({
      clock,
      pollIntervalMs: 1000,
      overallTimeoutMs: 60_000,
      fetchOne: async () => ({ failed: true }),
      classify: (state) =>
        state.failed ? { status: "failure", message: "nope" } : null,
      onTimeout: () => ({ status: "failure", message: "should not be reached" }),
    });

    assert.deepEqual(slept, []);
  });
});
