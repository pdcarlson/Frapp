import { describe, it, expect } from "vitest";
import { dedupeEmails, isInviteEmail } from "./index";

describe("dedupeEmails", () => {
  it("removes case-insensitive duplicates, keeping the first-seen casing", () => {
    expect(dedupeEmails(["Same@Example.com", "same@example.com"])).toEqual([
      "Same@Example.com",
    ]);
  });

  it("trims whitespace before comparing", () => {
    expect(dedupeEmails([" a@example.com ", "a@example.com"])).toEqual([
      "a@example.com",
    ]);
  });

  it("drops empty entries", () => {
    expect(dedupeEmails(["a@example.com", "  ", "", "b@example.com"])).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("preserves order of first occurrence", () => {
    expect(
      dedupeEmails(["b@example.com", "a@example.com", "b@example.com"]),
    ).toEqual(["b@example.com", "a@example.com"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(dedupeEmails([])).toEqual([]);
  });
});

describe("isInviteEmail", () => {
  it("accepts what the email invite route accepts, ignoring stray spaces", () => {
    expect(isInviteEmail("pledge@school.edu")).toBe(true);
    expect(isInviteEmail("  Pledge@School.edu ")).toBe(true);
  });

  it("refuses what the route would refuse", () => {
    expect(isInviteEmail("pledge@")).toBe(false);
    expect(isInviteEmail("not an email")).toBe(false);
    expect(isInviteEmail("")).toBe(false);
  });
});
