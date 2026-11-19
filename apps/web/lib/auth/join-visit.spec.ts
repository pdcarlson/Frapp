import { beforeEach, describe, expect, it } from "vitest";
import {
  clearJoinMark,
  INVITE_VISIT_MS,
  INVITE_VISIT_STORAGE_KEY,
  inviteVisitId,
  JOIN_MARK_MS,
  joinThenFor,
  rememberJoinMark,
  isJoinSkipCandidate,
  JOIN_FROM_SIGN_IN_PATH,
  shouldSkipJoinForMember,
} from "./join-visit";

const member = {
  from: "sign-in",
  membershipCount: 1,
  offerCount: 0,
  hasAccess: true,
};

describe("shouldSkipJoinForMember (#3850)", () => {
  it("skips the page for a member with access who came from the sign-in footer with no invite", () => {
    expect(shouldSkipJoinForMember(member)).toBe(true);
  });

  it("keeps the page when invites were emailed to the account", () => {
    expect(shouldSkipJoinForMember({ ...member, offerCount: 1 })).toBe(false);
  });

  it("keeps the page for a member with no role, whom /chat would send to /no-access", () => {
    expect(shouldSkipJoinForMember({ ...member, hasAccess: false })).toBe(
      false,
    );
  });

  it("keeps the page for an account with no chapter", () => {
    expect(shouldSkipJoinForMember({ ...member, membershipCount: 0 })).toBe(
      false,
    );
  });

  it("keeps the page for Join another chapter and /no-access, which arrive unmarked", () => {
    expect(shouldSkipJoinForMember({ ...member, from: null })).toBe(false);
    expect(isJoinSkipCandidate({ from: null })).toBe(false);
  });

  it("marks the footer's destination so the page can tell it apart", () => {
    expect(JOIN_FROM_SIGN_IN_PATH).toBe("/join?from=sign-in");
  });
});

describe("joinThenFor (#5625)", () => {
  const search = (q: string) => new URLSearchParams(q);
  beforeEach(clearJoinMark);

  it("returns the URL's then when this browser marked the same invite", () => {
    rememberJoinMark("tok-1", "join", 1_000);
    expect(joinThenFor("tok-1", search("token=tok-1&then=join"), 2_000)).toBe(
      "join",
    );
  });

  it("ignores a then the browser never marked, as a crafted link carries", () => {
    expect(joinThenFor("tok-1", search("token=tok-1&then=join"))).toBeNull();
  });

  it("ignores a mark for another invite or another action", () => {
    rememberJoinMark("tok-2", "join", 1_000);
    expect(joinThenFor("tok-1", search("then=join"), 2_000)).toBeNull();
    rememberJoinMark("tok-1", "ask", 1_000);
    expect(joinThenFor("tok-1", search("then=join"), 2_000)).toBeNull();
  });

  it("lets a mark lapse after half an hour", () => {
    rememberJoinMark("tok-1", "join", 0);
    expect(joinThenFor("tok-1", search("then=join"), JOIN_MARK_MS)).toBeNull();
  });

  it("returns nothing once the mark is cleared", () => {
    rememberJoinMark("tok-1", "join", 1_000);
    clearJoinMark();
    expect(joinThenFor("tok-1", search("then=join"), 2_000)).toBeNull();
  });
});

describe("inviteVisitId (#5663)", () => {
  const T0 = 1_800_000_000_000;
  beforeEach(() => {
    window.localStorage.removeItem(INVITE_VISIT_STORAGE_KEY);
  });

  it("keeps one visit per invite through a sign-in round trip", () => {
    const first = inviteVisitId("tok-1", T0, () => "visit-a");
    expect(first).toBe("visit-a");
    expect(inviteVisitId("tok-1", T0 + 60_000, () => "visit-b")).toBe(
      "visit-a",
    );
  });

  it("starts a new visit for another invite, or after a day", () => {
    inviteVisitId("tok-1", T0, () => "visit-a");
    expect(inviteVisitId("tok-2", T0, () => "visit-b")).toBe("visit-b");
    expect(inviteVisitId("tok-2", T0 + INVITE_VISIT_MS, () => "visit-c")).toBe(
      "visit-c",
    );
  });

  it("records nothing where no id can be minted", () => {
    expect(
      inviteVisitId("tok-1", T0, () => {
        throw new Error("insecure context");
      }),
    ).toBeNull();
  });
});
