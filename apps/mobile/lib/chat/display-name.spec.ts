import { describe, expect, it } from "vitest";
import { initialsFor, senderLabel } from "./display-name";

describe("initialsFor", () => {
  it("takes one initial from each of the first two words", () => {
    expect(initialsFor("Marcus Reid")).toBe("MR");
  });

  it("falls back to the first two letters of a single word", () => {
    expect(initialsFor("marcus")).toBe("MA");
  });

  it("survives an empty or whitespace-only name", () => {
    expect(initialsFor("   ")).toBe("?");
  });
});

describe("senderLabel", () => {
  it("says 'You' for the viewer's own message", () => {
    expect(senderLabel("user-1", true, "Marcus Reid")).toBe("You");
  });

  it("renders the resolved display name for another member", () => {
    // components.md specifies the meta line as `Name · time`; this is the half
    // that makes the shipped row spec-compliant.
    expect(senderLabel("user-1", false, "Marcus Reid")).toBe("Marcus Reid");
  });

  it("falls back to a truncated id only when the sender is unresolvable", () => {
    expect(
      senderLabel("22222222-2222-4222-8222-222222222222", false, null),
    ).toBe("Member 222222");
  });

  it("treats an empty resolved name as unresolvable rather than blank", () => {
    // Belt and braces over resolveDisplayName: users.display_name is
    // NOT NULL DEFAULT '', and a blank label is worse than a truncated id.
    expect(senderLabel("user-blank", false, "")).toBe("Member user-b");
  });
});
