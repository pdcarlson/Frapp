import { describe, expect, it } from "vitest";
import { motionTokens } from "./motion";
import { countUpValue, settleProgress, signatureMoment } from "./signature";

describe("signature moment", () => {
  it("keeps the budget README §7 states", () => {
    expect(signatureMoment).toEqual({
      totalMs: 1800,
      staggerMs: 60,
      maxStaggered: 8,
      countMs: 1200,
    });
    expect(motionTokens.duration.signature).toBe(520);
  });

  it("lands each piece inside the whole moment", () => {
    const { totalMs, staggerMs, maxStaggered, countMs } = signatureMoment;
    const lastLanding =
      (maxStaggered - 1) * staggerMs + motionTokens.duration.signature;
    expect(lastLanding).toBeLessThanOrEqual(totalMs);
    // The mark and the sweep play as the count lands.
    expect(countMs + motionTokens.duration.signature).toBeLessThanOrEqual(
      totalMs,
    );
  });

  it("settles from 0 to 1 and never past either end", () => {
    expect(settleProgress(-50, 1000)).toBe(0);
    expect(settleProgress(0, 1000)).toBe(0);
    expect(settleProgress(500, 1000)).toBeGreaterThan(0.5);
    expect(settleProgress(1000, 1000)).toBe(1);
    expect(settleProgress(4000, 1000)).toBe(1);
    expect(settleProgress(10, 0)).toBe(1);
  });

  it("counts up to exactly the target", () => {
    expect(countUpValue(145_952, 0)).toBe(0);
    expect(countUpValue(145_952, signatureMoment.countMs / 2)).toBeLessThan(
      145_952,
    );
    expect(countUpValue(145_952, signatureMoment.countMs)).toBe(145_952);
    expect(countUpValue(145_952, signatureMoment.countMs * 3)).toBe(145_952);
  });
});
