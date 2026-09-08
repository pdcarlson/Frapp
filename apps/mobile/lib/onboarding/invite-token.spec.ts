import { afterEach, describe, expect, it } from "vitest";
import {
  consumeRememberedInviteToken,
  extractInviteToken,
  extractInviteTokenFromQuery,
  peekRememberedInviteToken,
  rememberInviteToken,
} from "./invite-token";

afterEach(() => {
  consumeRememberedInviteToken();
});

describe("extractInviteToken", () => {
  it("re-exports the shared parser so a pasted join URL still works here", () => {
    expect(
      extractInviteToken("https://app.frapp.live/join?token=invite-abc"),
    ).toBe("invite-abc");
  });

  it("re-exports query seeding so ?invite= and ?code= fill the field", () => {
    const params = new URLSearchParams("invite=from-invite");
    expect(extractInviteTokenFromQuery((key) => params.get(key))).toBe(
      "from-invite",
    );
    expect(
      extractInviteTokenFromQuery((key) =>
        new URLSearchParams("code=from-code").get(key),
      ),
    ).toBe("from-code");
  });
});

describe("rememberInviteToken", () => {
  it("keeps the last non-empty token until consumed", () => {
    rememberInviteToken("first");
    expect(peekRememberedInviteToken()).toBe("first");
    rememberInviteToken(null);
    expect(peekRememberedInviteToken()).toBe("first");
    expect(consumeRememberedInviteToken()).toBe("first");
    expect(peekRememberedInviteToken()).toBeNull();
  });
});
