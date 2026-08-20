import { describe, expect, it } from "vitest";
import { formatPaddedStopwatch, formatTimer } from "./stopwatch";

describe("formatPaddedStopwatch", () => {
  it("zero-pads minutes below an hour", () => {
    expect(formatPaddedStopwatch(4 * 60 + 12)).toBe("04:12");
  });

  it("renders hours without padding the hour segment", () => {
    expect(formatPaddedStopwatch(1 * 3600 + 24 * 60 + 36)).toBe("1:24:36");
  });
});

describe("formatTimer", () => {
  it("renders the drawn over-an-hour reading", () => {
    expect(formatTimer(1 * 3600 + 24 * 60 + 36)).toBe("1:24:36");
  });

  it("drops the hour segment below an hour rather than padding a meaningless zero", () => {
    expect(formatTimer(4 * 60 + 12)).toBe("4:12");
    expect(formatTimer(9)).toBe("0:09");
  });

  it("floors partial seconds instead of rounding a second the member has not earned", () => {
    expect(formatTimer(59.9)).toBe("0:59");
  });

  it("never renders a negative clock", () => {
    expect(formatTimer(-10)).toBe("0:00");
  });
});
