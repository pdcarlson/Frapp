import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_API_ORIGINS,
  firstPartyTracePropagationTargets,
} from "./trace-targets";

describe("firstPartyTracePropagationTargets", () => {
  it("returns the three static API origins when no extra URL is given", () => {
    expect(firstPartyTracePropagationTargets(undefined)).toEqual([
      ...FIRST_PARTY_API_ORIGINS,
    ]);
  });

  it("unions a parseable extra origin and ignores junk", () => {
    const withExtra = firstPartyTracePropagationTargets(
      "https://api-preview.frapp.live/v1/health",
    );
    expect(withExtra).toContain("https://api-preview.frapp.live");
    expect(withExtra).toEqual(
      expect.arrayContaining([...FIRST_PARTY_API_ORIGINS]),
    );

    const withJunk = firstPartyTracePropagationTargets("not a url");
    expect(withJunk).toEqual([...FIRST_PARTY_API_ORIGINS]);
  });

  it("does not treat x-request-id, PostHog, Sentry ingest, or marketing as targets", () => {
    const joined = firstPartyTracePropagationTargets(
      "https://api.frapp.live",
    ).join(" ");
    expect(joined).not.toContain("x-request-id");
    expect(joined).not.toMatch(/posthog/i);
    expect(joined).not.toMatch(/sentry\.io/);
    expect(joined).not.toContain("supabase");
    expect(joined).not.toContain("https://app.frapp.live");
    expect(joined).not.toContain("https://frapp.live/");
  });
});
