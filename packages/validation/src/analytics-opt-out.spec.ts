import { describe, expect, it } from "vitest";
import { isAnalyticsOptedOut } from "./analytics-opt-out";
import { CurrentChapterPayloadSchema } from "./index";

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

describe("CurrentChapterPayloadSchema analytics_opt_out", () => {
  const base = {
    name: "Alpha",
    university: "State",
    subscription_status: "active" as const,
  };

  it("keeps the scalar optional so a missing column fails open", () => {
    const parsed = CurrentChapterPayloadSchema.parse(base);
    expect(parsed.analytics_opt_out).toBeUndefined();
    expect(isAnalyticsOptedOut(parsed.analytics_opt_out)).toBe(false);
  });

  it("reads an explicit true off GET /v1/chapters/current", () => {
    const parsed = CurrentChapterPayloadSchema.parse({
      ...base,
      analytics_opt_out: true,
    });
    expect(isAnalyticsOptedOut(parsed.analytics_opt_out)).toBe(true);
  });
});
