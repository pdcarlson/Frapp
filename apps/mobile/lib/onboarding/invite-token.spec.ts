import { afterEach, describe, expect, it } from "vitest";
import {
  consumeRememberedInviteToken,
  extractInviteToken,
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
