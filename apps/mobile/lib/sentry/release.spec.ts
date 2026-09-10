import { describe, expect, it } from "vitest";
import { formatMobileSentryDist, formatMobileSentryRelease } from "./release";

const GIT_SHA = "deadbeefcafebabe0123456789abcdef01234567";

describe("formatMobileSentryRelease", () => {
  it("is bundleId@version+nativeBuildNumber, never a git SHA", () => {
    expect(
      formatMobileSentryRelease({
        bundleId: "live.frapp.mobile",
        version: "1.0.0",
        nativeBuildNumber: "12",
      }),
    ).toBe("live.frapp.mobile@1.0.0+12");
  });

  it("omits rather than inventing when any piece is missing", () => {
    expect(
      formatMobileSentryRelease({
        bundleId: "live.frapp.mobile",
        version: "1.0.0",
        nativeBuildNumber: null,
      }),
    ).toBeUndefined();
    expect(
      formatMobileSentryRelease({
        bundleId: GIT_SHA,
        version: "1.0.0",
        nativeBuildNumber: undefined,
      }),
    ).toBeUndefined();
  });

  it("does not use a git SHA as the release string", () => {
    const release = formatMobileSentryRelease({
      bundleId: "live.frapp.mobile",
      version: "1.0.0",
      nativeBuildNumber: "1",
    });
    expect(release).not.toBe(GIT_SHA);
    expect(release).not.toContain(GIT_SHA);
  });
});

describe("formatMobileSentryDist", () => {
  it("is the native build number only", () => {
    expect(formatMobileSentryDist("12")).toBe("12");
    expect(formatMobileSentryDist("  ")).toBeUndefined();
    expect(formatMobileSentryDist(undefined)).toBeUndefined();
  });
});
