import { describe, expect, it } from "vitest";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  canMessageMember,
  dmChannelIdOf,
  otherRealMemberId,
} from "./start-dm";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";

const READY_EMPTY = { status: "ready" as const, ids: new Set<string>() };

describe("otherRealMemberId", () => {
  it("is the member's id on another member's profile", () => {
    expect(otherRealMemberId(MEMBER, VIEWER)).toBe(MEMBER);
  });

  it("is null on the viewer's own profile, since the API would create a DM with yourself", () => {
    expect(otherRealMemberId(VIEWER, VIEWER)).toBeNull();
  });

  it("is null until the viewer is known, so an unresolved viewer never reads as someone else", () => {
    expect(otherRealMemberId(VIEWER, null)).toBeNull();
  });

  it("is null before the member's profile loads", () => {
    expect(otherRealMemberId(null, VIEWER)).toBeNull();
  });

  it("is null for the system actor", () => {
    expect(otherRealMemberId(SYSTEM_SENDER_ID, VIEWER)).toBeNull();
  });
});

describe("canMessageMember", () => {
  it("offers Message for another member once the block list is ready", () => {
    expect(
      canMessageMember({ memberId: MEMBER, blockList: READY_EMPTY }),
    ).toBe(true);
  });

  it("withholds it when there is no other member", () => {
    expect(canMessageMember({ memberId: null, blockList: READY_EMPTY })).toBe(
      false,
    );
  });

  it("withholds it for a member the viewer blocked", () => {
    expect(
      canMessageMember({
        memberId: MEMBER,
        blockList: { status: "ready", ids: new Set([MEMBER]) },
      }),
    ).toBe(false);
  });

  // The ids are a floor: a block from an earlier session or another device is
  // missing from them until the list is read, so an empty set proves nothing.
  it.each(["loading", "unavailable"] as const)(
    "withholds it while the block list is %s, since the ids are only a floor",
    (status) => {
      expect(
        canMessageMember({
          memberId: MEMBER,
          blockList: { status, ids: new Set<string>() },
        }),
      ).toBe(false);
    },
  );
});

describe("dmChannelIdOf", () => {
  it("reads the channel id from the DM response", () => {
    expect(dmChannelIdOf({ id: "chan-1", type: "DM" })).toBe("chan-1");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a body with no id", { type: "DM" }],
    ["an empty id", { id: "" }],
    ["a non-string id", { id: 42 }],
  ])("returns null for %s, so the caller reports a failure", (_, body) => {
    expect(dmChannelIdOf(body)).toBeNull();
  });
});
