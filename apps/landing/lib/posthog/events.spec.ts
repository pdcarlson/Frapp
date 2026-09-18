import { describe, expect, it } from "vitest";
import { LANDING_CTA_EVENT, LANDING_CTAS, LANDING_CTA_SURFACES } from "./events";

describe("landing analytics event names", () => {
  it("uses kebab-case CTA event and closed allowlists", () => {
    expect(LANDING_CTA_EVENT).toBe("landing-cta-clicked");
    expect(LANDING_CTAS).toEqual(["get-started", "log-in", "join-chapter"]);
    expect(LANDING_CTA_SURFACES).toEqual([
      "header",
      "hero",
      "pricing",
      "footer",
      "cta-band",
    ]);
  });

  it("drops the CTA ids the rebuilt page no longer renders", () => {
    // Both died with their sections in #2367: the single $149 card's
    // "Start free trial" and the hero's "Explore the product" anchor.
    expect(LANDING_CTAS).not.toContain("start-free-trial");
    expect(LANDING_CTAS).not.toContain("explore-the-product");
  });

  it("keeps log-in as an id so the PostHog funnel survives the relabel", () => {
    // The control reads "Sign in" (D5). The id is the join key for every row
    // already captured, so it deliberately does not follow the copy.
    expect(LANDING_CTAS).toContain("log-in");
    expect(LANDING_CTAS).not.toContain("sign-in");
  });
});
