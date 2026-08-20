import { describe, expect, it } from "vitest";
import { needsFirstRun, selectOnboardingMembership } from "./membership";

const incomplete = {
  chapter_id: "chapter-a",
  has_completed_onboarding: false,
};
const complete = {
  chapter_id: "chapter-b",
  has_completed_onboarding: true,
};

describe("selectOnboardingMembership", () => {
  it("returns null for an empty list", () => {
    expect(selectOnboardingMembership([], "chapter-a")).toBeNull();
  });

  it("prefers the membership matching the claim", () => {
    expect(
      selectOnboardingMembership([incomplete, complete], "chapter-b"),
    ).toEqual(complete);
  });

  it("uses the sole membership when no claim is present", () => {
    expect(selectOnboardingMembership([incomplete], null)).toEqual(incomplete);
  });

  it("does not guess among several memberships without a claim", () => {
    expect(
      selectOnboardingMembership([incomplete, complete], null),
    ).toBeNull();
  });
});

describe("needsFirstRun", () => {
  it("is true only for the active membership that has not finished", () => {
    expect(needsFirstRun([incomplete], null)).toBe(true);
    expect(needsFirstRun([complete], null)).toBe(false);
    expect(needsFirstRun([incomplete, complete], "chapter-b")).toBe(false);
    expect(needsFirstRun([incomplete, complete], "chapter-a")).toBe(true);
  });
});
