import { describe, expect, it } from "vitest";
import {
  isAnalyticsOptedOut,
  isChapterAnalyticsOptedOut,
} from "./analytics-opt-out";

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

describe("isChapterAnalyticsOptedOut", () => {
  // Pending, failed with nothing cached, or no active chapter (#2957).
  it("counts a chapter read that hasn't answered as opted out", () => {
    expect(isChapterAnalyticsOptedOut(undefined)).toBe(true);
    expect(isChapterAnalyticsOptedOut(null)).toBe(true);
  });

  it("lets a loaded payload's flag decide, failing open on the flag", () => {
    expect(isChapterAnalyticsOptedOut({ analytics_opt_out: true })).toBe(true);
    expect(isChapterAnalyticsOptedOut({ analytics_opt_out: false })).toBe(
      false,
    );
    expect(isChapterAnalyticsOptedOut({})).toBe(false);
  });
});
