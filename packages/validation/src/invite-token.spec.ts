import { describe, expect, it } from "vitest";
import { extractInviteToken } from "./invite-token";

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

  it("decodes a token that had to be percent-encoded in the query", () => {
    expect(
      extractInviteToken("https://app.frapp.live/join?token=a%20b%2Fc"),
    ).toBe("a b/c");
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

  it("rejects empty, whitespace, short strings, and a join URL with no token", () => {
    expect(extractInviteToken("")).toBeNull();
    expect(extractInviteToken("   ")).toBeNull();
    expect(extractInviteToken("abc")).toBeNull();
    expect(extractInviteToken(null)).toBeNull();
    expect(extractInviteToken("https://app.frapp.live/join")).toBeNull();
  });
});
