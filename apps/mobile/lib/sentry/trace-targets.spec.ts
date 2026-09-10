import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_API_ORIGINS,
  mobileTracePropagationTargets,
} from "./trace-targets";

describe("mobileTracePropagationTargets", () => {
  it("always includes the three first-party API origins", () => {
    const targets = mobileTracePropagationTargets(undefined);
    expect(targets).toEqual([...FIRST_PARTY_API_ORIGINS]);
  });

  it("adds the configured API origin and never PostHog, Sentry, or Supabase", () => {
    const targets = mobileTracePropagationTargets(
      "https://api-staging.frapp.live",
    );
    expect(targets).toContain("https://api-staging.frapp.live");
    expect(targets).toContain("http://localhost:3001");
    expect(targets).toContain("https://api.frapp.live");
    const joined = targets.join(" ");
    expect(joined).not.toMatch(/posthog/i);
    expect(joined).not.toMatch(/sentry\.io/);
    expect(targets.some((t) => t.includes("supabase"))).toBe(false);
    expect(targets).not.toContain("https://app.frapp.live");
    expect(targets).not.toContain("https://frapp.live");
  });

  it("does not treat x-request-id as a trace target", () => {
    expect(mobileTracePropagationTargets().join(" ")).not.toContain(
      "x-request-id",
    );
  });
});
