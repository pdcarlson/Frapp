import { describe, expect, it } from "vitest";
import { mobileTracePropagationTargets } from "./trace-targets";
import { FIRST_PARTY_API_ORIGINS } from "@repo/observability";

describe("mobileTracePropagationTargets", () => {
  it("forwards an omitted Expo API URL to the shared first-party list", () => {
    expect(mobileTracePropagationTargets(undefined)).toEqual([
      ...FIRST_PARTY_API_ORIGINS,
    ]);
  });

  it("adds a custom Expo API origin and never a third-party ingest host", () => {
    const targets = mobileTracePropagationTargets(
      "https://api.frapp.live/v1/health",
    );
    expect(targets).toContain("https://api.frapp.live");
    expect(targets).toEqual(expect.arrayContaining([...FIRST_PARTY_API_ORIGINS]));
    expect(targets.some((origin) => /posthog|ingest\.sentry|supabase/i.test(origin))).toBe(
      false,
    );
  });

  it("does not encode the request-id header as a trace target", () => {
    expect(
      mobileTracePropagationTargets("https://api-staging.frapp.live").includes(
        "x-request-id",
      ),
    ).toBe(false);
  });
});
