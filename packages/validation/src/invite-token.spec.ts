import { describe, expect, it } from "vitest";
import {
  extractInviteToken,
  extractInviteTokenFromQuery,
} from "./invite-token";

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

  it("reads token= out of the Members Copy-link clipboard payload", () => {
    const pasted = [
      "Frapp member invite",
      "Role: President",
      "https://app.frapp.live/join?token=550e8400-e29b-41d4-a716-446655440000",
      "Expires: Sep 9, 2026",
    ].join("\n");
    expect(extractInviteToken(pasted)).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("strips wrapping punctuation and a missing scheme", () => {
    expect(
      extractInviteToken(
        "https://app.frapp.live/join?token=550e8400-e29b-41d4-a716-446655440000.",
      ),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(
      extractInviteToken(
        "app.frapp.live/join?token=550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("extractInviteTokenFromQuery", () => {
  function fromSearch(query: string): string | null {
    const params = new URLSearchParams(query);
    return extractInviteTokenFromQuery((key) => params.get(key));
  }

  it("seeds token, invite, and code aliases", () => {
    expect(fromSearch("token=invite-from-token")).toBe("invite-from-token");
    expect(fromSearch("invite=invite-from-invite")).toBe("invite-from-invite");
    expect(fromSearch("code=invite-from-code")).toBe("invite-from-code");
  });

  it("prefers token over invite and code", () => {
    expect(fromSearch("token=from-token&invite=from-invite&code=from-code")).toBe(
      "from-token",
    );
  });

  it("skips an empty token key and reads invite", () => {
    expect(fromSearch("token=&invite=from-invite")).toBe("from-invite");
    expect(fromSearch("token=   &invite=from-invite")).toBe("from-invite");
  });

  it("keeps a present but unparseable alias so the form can show it", () => {
    expect(fromSearch("token=abc")).toBe("abc");
  });

  it("extracts a full join URL stuffed into invite=", () => {
    expect(
      fromSearch(
        "invite=https://app.frapp.live/join?token=550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns null when no alias is present", () => {
    expect(fromSearch("role=President")).toBeNull();
    expect(fromSearch("")).toBeNull();
  });
});
