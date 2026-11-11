import { describe, expect, it } from "vitest";
import { inviteFromRouteParams, memberInviteWebUrl } from "./member-invite";

describe("an invite link opened by a member with a chapter (#4002)", () => {
  it("reads the invite from the route's params, in web /join's key order", () => {
    expect(inviteFromRouteParams({ token: "abc" })).toBe("abc");
    expect(inviteFromRouteParams({ code: "xyz" })).toBe("xyz");
    expect(inviteFromRouteParams({ token: ["first", "second"] })).toBe("first");
    expect(inviteFromRouteParams({ token: "" })).toBeNull();
    expect(inviteFromRouteParams({})).toBeNull();
  });

  it("hands it to web /join marked as chosen in the browser", () => {
    expect(memberInviteWebUrl("a b", "https://app.frapp.live")).toBe(
      "https://app.frapp.live/join?token=a%20b&web=1",
    );
  });
});
