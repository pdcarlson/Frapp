import { describe, expect, it } from "vitest";

import { isMemberInviteMoment } from "./member-invite";

describe("an invite link opened by a member with a chapter (#4002, #4341)", () => {
  it("is the member path on their tabs, the Terms prompt or s03", () => {
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
});
