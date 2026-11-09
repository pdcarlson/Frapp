import { describe, expect, it } from "vitest";
import {
  isJoinSkipCandidate,
  JOIN_FROM_SIGN_IN_PATH,
  shouldSkipJoinForMember,
} from "./join-visit";

const member = {
  from: "sign-in",
  hasInvite: false,
  membershipCount: 1,
  offerCount: 0,
  hasAccess: true,
};

describe("shouldSkipJoinForMember (#3850)", () => {
  it("skips the page for a member with access who came from the sign-in footer with no invite", () => {
    expect(shouldSkipJoinForMember(member)).toBe(true);
  });

  it("keeps the page when the visit carries an invite, which may be for another chapter", () => {
    expect(shouldSkipJoinForMember({ ...member, hasInvite: true })).toBe(false);
  });

  it("keeps the page when invites were emailed to the account", () => {
    expect(shouldSkipJoinForMember({ ...member, offerCount: 1 })).toBe(false);
  });

  it("keeps the page for a member with no role, whom /chat would send to /no-access", () => {
    expect(shouldSkipJoinForMember({ ...member, hasAccess: false })).toBe(false);
  });

  it("keeps the page for an account with no chapter", () => {
    expect(shouldSkipJoinForMember({ ...member, membershipCount: 0 })).toBe(
      false,
    );
  });

  it("keeps the page for Join another chapter and /no-access, which arrive unmarked", () => {
    expect(shouldSkipJoinForMember({ ...member, from: null })).toBe(false);
    expect(isJoinSkipCandidate({ from: null, hasInvite: false })).toBe(false);
  });

  it("marks the footer's destination so the page can tell it apart", () => {
    expect(JOIN_FROM_SIGN_IN_PATH).toBe("/join?from=sign-in");
  });
});
