import { describe, expect, it } from "vitest";
import { webTracePropagationTargets } from "./trace-targets";
import { FIRST_PARTY_API_ORIGINS } from "@repo/observability";

describe("webTracePropagationTargets", () => {
  it("forwards an omitted URL to the shared first-party list", () => {
    expect(webTracePropagationTargets(undefined)).toEqual([
      ...FIRST_PARTY_API_ORIGINS,
    ]);
  });

  it("passes the configured NEXT API origin through without marketing hosts", () => {
    const targets = webTracePropagationTargets(
      "https://api-staging.frapp.live/graphql",
    );
    expect(targets).toContain("https://api-staging.frapp.live");
    expect(targets.join(" ")).not.toMatch(/posthog|sentry\.io|supabase/i);
    expect(targets).not.toContain("https://app.frapp.live");
  });

  it("keeps x-request-id out of the target list", () => {
    expect(webTracePropagationTargets().join(" ")).not.toContain(
      "x-request-id",
    );
  });
});
