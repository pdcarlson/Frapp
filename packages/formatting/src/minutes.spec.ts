import { describe, expect, it } from "vitest";
import { formatMinutesExact, formatMinutesRounded } from "./minutes";

describe("formatMinutesExact", () => {
  it("renders hours and minutes without rounding", () => {
    expect(formatMinutesExact(150)).toBe("2h 30m");
    expect(formatMinutesExact(120)).toBe("2h");
    expect(formatMinutesExact(45)).toBe("45m");
  });

  it("passes a fractional minute through below an hour", () => {
    expect(formatMinutesExact(1.5)).toBe("1.5m");
  });
});

describe("formatMinutesRounded", () => {
  it("renders hours and minutes the way a member writes them", () => {
    expect(formatMinutesRounded(150)).toBe("2h 30m");
    expect(formatMinutesRounded(120)).toBe("2h");
    expect(formatMinutesRounded(45)).toBe("45m");
    expect(formatMinutesRounded(0)).toBe("0m");
  });

  it("rounds to the nearest whole minute", () => {
    expect(formatMinutesRounded(1.4)).toBe("1m");
    expect(formatMinutesRounded(1.5)).toBe("2m");
  });

  it("never renders a negative duration", () => {
    expect(formatMinutesRounded(-30)).toBe("0m");
  });
});
