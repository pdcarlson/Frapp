import { describe, expect, it } from "vitest";

import { isMemberInviteMoment, memberInviteWebUrl } from "./member-invite";

describe("an invite link opened by a member with a chapter (#4002)", () => {
  it("goes to the web for a member on their tabs, the Terms prompt or s03", () => {
    for (const destination of ["tabs", "terms", "welcome"] as const) {
      expect(isMemberInviteMoment(destination, 1)).toBe(true);
    }
  });

  it("stays with s02 for an account with no chapter, or one not yet known", () => {
    expect(isMemberInviteMoment("join", 0)).toBe(false);
    // The gate says tabs when the chapters read failed with nothing cached.
    expect(isMemberInviteMoment("tabs", null)).toBe(false);
    expect(isMemberInviteMoment("tabs", 0)).toBe(false);
    expect(isMemberInviteMoment("hold", 1)).toBe(false);
    expect(isMemberInviteMoment("sign-in", null)).toBe(false);
  });

  it("hands it to web /join marked as chosen in the browser", () => {
    expect(memberInviteWebUrl("a b", "https://app.frapp.live")).toBe(
      "https://app.frapp.live/join?token=a%20b&web=1",
    );
  });
});
