import { describe, expect, it } from "vitest";
import { extractInviteToken } from "@repo/validation";
import { buildJoinUrl } from "./invite-link";

describe("buildJoinUrl", () => {
  it("builds a same-origin /join?token= URL", () => {
    expect(buildJoinUrl("https://app.frapp.live", "ABC123")).toBe(
      "https://app.frapp.live/join?token=ABC123",
    );
  });

  it("encodes characters that would break the query", () => {
    expect(buildJoinUrl("https://app.frapp.live", "a b/c")).toBe(
      "https://app.frapp.live/join?token=a%20b%2Fc",
    );
  });

  it("round-trips through extractInviteToken so a pasted copy still redeems", () => {
    const url = buildJoinUrl("https://app.frapp.live", "invite-abc");
    expect(extractInviteToken(url)).toBe("invite-abc");
    expect(extractInviteToken(buildJoinUrl("https://app.frapp.live", "a b/c"))).toBe(
      "a b/c",
    );
  });

  it("refuses a public http: origin before attaching the token", () => {
    expect(() =>
      buildJoinUrl("http://app.frapp.live", "secret-invite"),
    ).toThrow(/must use https:/);
    try {
      buildJoinUrl("http://app.example.com", "secret-invite");
      throw new Error("expected refuse");
    } catch (error) {
      expect(String(error)).not.toContain("secret-invite");
    }
  });

  it("allows loopback http: so local Infisical APP_URL still copies", () => {
    expect(buildJoinUrl("http://localhost:3000", "local-token")).toBe(
      "http://localhost:3000/join?token=local-token",
    );
  });
});
