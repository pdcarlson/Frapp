import { describe, expect, it } from "vitest";
import { activityCountChip } from "./count-chip";

describe("activityCountChip (#3897)", () => {
  it("draws no chip before the read answers or while nothing waits", () => {
    expect(activityCountChip(undefined)).toBeNull();
    expect(
      activityCountChip({ needs_you_count: 0, unavailable: [] }),
    ).toBeNull();
  });

  it("states the count of what is waiting", () => {
    expect(activityCountChip({ needs_you_count: 3, unavailable: [] })).toEqual({
      label: "3",
      spoken: "3 waiting on you",
    });
  });

  it("says at least when a counted section couldn't be read", () => {
    expect(
      activityCountChip({ needs_you_count: 2, unavailable: ["tasks"] }),
    ).toEqual({ label: "2+", spoken: "at least 2 waiting on you" });
  });

  it("keeps the plain count when only an uncounted section failed", () => {
    expect(
      activityCountChip({ needs_you_count: 2, unavailable: ["made_events"] })
        ?.label,
    ).toBe("2");
  });

  it("draws no chip from a failed section alone: the screen names it", () => {
    expect(
      activityCountChip({ needs_you_count: 0, unavailable: ["polls"] }),
    ).toBeNull();
  });
});
