import { describe, expect, it } from "vitest";
import { isAnalyticsOptedOut } from "./analytics-opt-out";

describe("isAnalyticsOptedOut", () => {
  it("fails open: missing or false is not an opt-out", () => {
    expect(isAnalyticsOptedOut(undefined)).toBe(false);
    expect(isAnalyticsOptedOut(null)).toBe(false);
    expect(isAnalyticsOptedOut(false)).toBe(false);
  });

  it("suppresses events only for an explicit true", () => {
    expect(isAnalyticsOptedOut(true)).toBe(true);
  });
});
