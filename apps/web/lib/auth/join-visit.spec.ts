import { describe, expect, it } from "vitest";
import {
  JOIN_FROM_SIGN_IN_PATH,
  shouldSkipJoinForMember,
} from "./join-visit";

describe("shouldSkipJoinForMember (#3850)", () => {
  it("skips the page for a member who came from the sign-in footer with no invite", () => {
    expect(
      shouldSkipJoinForMember({
        from: "sign-in",
        hasInvite: false,
        membershipCount: 1,
      }),
    ).toBe(true);
  });

  it("keeps the page when the visit carries an invite, which may be for another chapter", () => {
    expect(
      shouldSkipJoinForMember({
        from: "sign-in",
        hasInvite: true,
        membershipCount: 1,
      }),
    ).toBe(false);
  });

  it("keeps the page for an account with no chapter", () => {
    expect(
      shouldSkipJoinForMember({
        from: "sign-in",
        hasInvite: false,
        membershipCount: 0,
      }),
    ).toBe(false);
  });

  it("keeps the page for Join another chapter and /no-access, which arrive unmarked", () => {
    expect(
      shouldSkipJoinForMember({
        from: null,
        hasInvite: false,
        membershipCount: 2,
      }),
    ).toBe(false);
  });

  it("marks the footer's destination so the page can tell it apart", () => {
    expect(JOIN_FROM_SIGN_IN_PATH).toBe("/join?from=sign-in");
  });
});
