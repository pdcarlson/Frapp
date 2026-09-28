import { describe, expect, it } from "vitest";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { canMessageMember, dmChannelIdOf } from "./start-dm";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";

describe("canMessageMember", () => {
  it("offers Message on another member's profile", () => {
    expect(
      canMessageMember({
        memberUserId: MEMBER,
        viewerUserId: VIEWER,
        isBlocked: false,
      }),
    ).toBe(true);
  });

  it("withholds it on the viewer's own profile, since the API would create a DM with yourself", () => {
    expect(
      canMessageMember({
        memberUserId: VIEWER,
        viewerUserId: VIEWER,
        isBlocked: false,
      }),
    ).toBe(false);
  });

  it("withholds it until the viewer is known, so an unresolved viewer never reads as someone else", () => {
    expect(
      canMessageMember({
        memberUserId: VIEWER,
        viewerUserId: null,
        isBlocked: false,
      }),
    ).toBe(false);
  });

  it("withholds it before the member's profile loads", () => {
    expect(
      canMessageMember({
        memberUserId: null,
        viewerUserId: VIEWER,
        isBlocked: false,
      }),
    ).toBe(false);
  });

  it("withholds it for the system actor", () => {
    expect(
      canMessageMember({
        memberUserId: SYSTEM_SENDER_ID,
        viewerUserId: VIEWER,
        isBlocked: false,
      }),
    ).toBe(false);
  });

  it("withholds it for a member the viewer blocked", () => {
    expect(
      canMessageMember({
        memberUserId: MEMBER,
        viewerUserId: VIEWER,
        isBlocked: true,
      }),
    ).toBe(false);
  });
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
