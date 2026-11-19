import { describe, expect, it } from "vitest";
import { installHandoffCopy, pastedInviteToken } from "./invite-paste";

const INVITE_ID = "6f1c2a9e-3b4d-4c8e-9a7b-1d2e3f4a5b6c";

describe("pastedInviteToken", () => {
  it("finds the invite in a join link, on the web or the app's scheme", () => {
    expect(
      pastedInviteToken(`https://app.frapp.live/join?token=${INVITE_ID}`),
    ).toBe(INVITE_ID);
    expect(pastedInviteToken(`frapp-staging://join?token=${INVITE_ID}`)).toBe(
      INVITE_ID,
    );
  });

  it("finds it in a link pasted with words around it", () => {
    expect(
      pastedInviteToken(
        `Join us on Frapp: https://app.frapp.live/join?token=${INVITE_ID} (good for a week)`,
      ),
    ).toBe(INVITE_ID);
  });

  it("takes a bare invite, the way an officer might copy just the code", () => {
    expect(pastedInviteToken(`  ${INVITE_ID.toUpperCase()}\n`)).toBe(
      INVITE_ID.toUpperCase(),
    );
  });

  it("says no to whatever else was on the clipboard", () => {
    expect(pastedInviteToken("")).toBeNull();
    expect(pastedInviteToken(null)).toBeNull();
    expect(pastedInviteToken("1Z999AA10123456784")).toBeNull();
    expect(pastedInviteToken("see you at chapter tonight")).toBeNull();
    expect(pastedInviteToken("https://example.com/?code=abc12345")).toBeNull();
  });
});

describe("installHandoffCopy", () => {
  it("names the environment's app in every line", () => {
    const copy = installHandoffCopy("Frapp Staging");
    expect(copy.copied).toBe(
      "Invite copied. When Frapp Staging opens, tap Paste.",
    );
    expect(copy.getDetail).toContain("Get Frapp Staging");
    expect(copy.pasteDetail).toContain("Open Frapp Staging");
  });
});
