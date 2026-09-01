import { describe, expect, it } from "vitest";
import { shouldShowDonationCta } from "./donation";

describe("shouldShowDonationCta", () => {
  it("shows the CTA for an alumni permission set with a configured URL", () => {
    expect(
      shouldShowDonationCta(["members:view", "alumni:post"], "https://example.edu/give"),
    ).toBe(true);
  });

  it("hides the CTA for a non-alumni permission set", () => {
    expect(
      shouldShowDonationCta(["members:view", "points:adjust"], "https://example.edu/give"),
    ).toBe(false);
  });

  it("hides the CTA when the chapter has no donation_url configured", () => {
    expect(shouldShowDonationCta(["members:view", "alumni:post"], null)).toBe(
      false,
    );
    expect(
      shouldShowDonationCta(["members:view", "alumni:post"], undefined),
    ).toBe(false);
    expect(shouldShowDonationCta(["members:view", "alumni:post"], "")).toBe(
      false,
    );
  });

  it("hides the CTA for an empty or missing permission set", () => {
    expect(shouldShowDonationCta([], "https://example.edu/give")).toBe(false);
  });

  // The wildcard grant (President) reads as "can do everything", matching the
  // `can()` convention used everywhere else in this codebase.
  it("shows the CTA for a wildcard permission holder", () => {
    expect(shouldShowDonationCta(["*"], "https://example.edu/give")).toBe(
      true,
    );
  });
});
