import { describe, expect, it } from "vitest";
import { pathOnlyAnalyticsPath } from "./analytics-path";

describe("pathOnlyAnalyticsPath", () => {
  it("keeps an origin-form path and drops query, fragment, and authority", () => {
    expect(pathOnlyAnalyticsPath("/privacy")).toBe("/privacy");
    expect(pathOnlyAnalyticsPath("/join?token=invite-token-secret")).toBe(
      "/join",
    );
    expect(pathOnlyAnalyticsPath("/join#frag")).toBe("/join");
    expect(
      pathOnlyAnalyticsPath(
        "https://frapp.live/join?token=invite-token-secret&email=a@b.c",
      ),
    ).toBe("/join");
  });

  it("rejects values that are not a path after stripping", () => {
    expect(pathOnlyAnalyticsPath("")).toBeUndefined();
    expect(pathOnlyAnalyticsPath("mailto:a@b.c")).toBeUndefined();
    expect(pathOnlyAnalyticsPath("not-a-path")).toBeUndefined();
  });
});
