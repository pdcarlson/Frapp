import { describe, expect, it, vi } from "vitest";
import { createScanLatch } from "./scan-latch";

describe("createScanLatch", () => {
  it("admits the first read and drops the rest until released", () => {
    const latch = createScanLatch();

    expect(latch.accept("code-a")).toBe(true);
    expect(latch.accept("code-a")).toBe(false);
    expect(latch.accept("code-a")).toBe(false);
    expect(latch.current).toBe("code-a");
  });

  it("drops a *different* code while one is in flight", () => {
    // Two codes in frame at once (a poster beside the host screen) must not
    // both fire — the member gets one attempt at a time, whichever landed first.
    const latch = createScanLatch();

    expect(latch.accept("code-a")).toBe(true);
    expect(latch.accept("code-b")).toBe(false);
    expect(latch.current).toBe("code-a");
  });

  it("admits again after release, so a retry is possible", () => {
    const latch = createScanLatch();

    latch.accept("code-a");
    latch.release();

    expect(latch.current).toBeNull();
    expect(latch.accept("code-b")).toBe(true);
  });

  it("ignores an empty read rather than latching on nothing", () => {
    const latch = createScanLatch();

    expect(latch.accept("")).toBe(false);
    expect(latch.current).toBeNull();
    expect(latch.accept("code-a")).toBe(true);
  });

  /**
   * The behaviour the acceptance criterion names: "one physical code MUST NOT
   * become N redemption attempts". Simulates the real callback pattern —
   * expo-camera firing repeatedly while the code stays in frame.
   */
  it("turns a burst of reads of one code into exactly one submission", () => {
    const latch = createScanLatch();
    const submit = vi.fn();

    for (let i = 0; i < 40; i++) {
      if (latch.accept("code-a")) submit("code-a");
    }

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("allows exactly one more submission per release", () => {
    const latch = createScanLatch();
    const submit = vi.fn();

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 10; i++) {
        if (latch.accept(`code-${round}`)) submit();
      }
      latch.release();
    }

    expect(submit).toHaveBeenCalledTimes(3);
  });
});

/**
 * The foreign-code path in `app/(tabs)/check-in.tsx` deliberately does *not*
 * use this latch — it keeps its own "last reported" ref instead. These cases
 * pin why: borrowing the latch there would leave it closed on a code that never
 * submits, starving the real one.
 */
describe("latch is not a general de-duplicator", () => {
  it("stays closed until released, which is wrong for a non-submitting path", () => {
    const latch = createScanLatch();

    // A foreign code claims the latch...
    expect(latch.accept("foreign")).toBe(true);
    // ...and the real code is now starved, with nothing in flight to release it.
    expect(latch.accept("ours")).toBe(false);
  });
});
