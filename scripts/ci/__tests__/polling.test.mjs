import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createClock } from "../lib/polling.mjs";

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
