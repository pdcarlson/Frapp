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
  it("returns a pasted bare token", () => {
    expect(extractInviteToken("  abcdefgh-1234-5678  ")).toBe(
      "abcdefgh-1234-5678",
    );
  });

  it("reads token= off a web join URL", () => {
    expect(
      extractInviteToken("https://app.frapp.live/join?token=invite-abc"),
    ).toBe("invite-abc");
  });

  it("reads token= off the app scheme", () => {
    expect(extractInviteToken("frapp://join?token=invite-xyz")).toBe(
      "invite-xyz",
    );
  });

  it("accepts the invite/code aliases and a hash", () => {
    expect(extractInviteToken("/join?invite=from-query")).toBe("from-query");
    expect(extractInviteToken("https://example.test/join#token=from-hash")).toBe(
      "from-hash",
    );
  });

  it("rejects empty, whitespace, and short strings", () => {
    expect(extractInviteToken("")).toBeNull();
    expect(extractInviteToken("   ")).toBeNull();
    expect(extractInviteToken("abc")).toBeNull();
    expect(extractInviteToken(null)).toBeNull();
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
