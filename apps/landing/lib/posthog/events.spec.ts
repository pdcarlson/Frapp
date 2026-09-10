import { describe, expect, it } from "vitest";
import { LANDING_CTA_EVENT, LANDING_CTAS, LANDING_CTA_SURFACES } from "./events";

describe("landing analytics event names", () => {
  it("uses kebab-case CTA event and closed allowlists", () => {
    expect(LANDING_CTA_EVENT).toBe("landing-cta-clicked");
    expect(LANDING_CTAS).toEqual([
      "get-started",
      "log-in",
      "start-free-trial",
      "explore-the-product",
    ]);
    expect(LANDING_CTA_SURFACES).toEqual([
      "header",
      "hero",
      "pricing",
      "footer",
      "cta-band",
    ]);
  });
});
