import { describe, expect, it } from "vitest";
import { readActiveChapterClaim } from "./active-chapter-claim";

const b64url = (obj: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: "ES256", typ: "JWT" })}.${b64url(payload)}.opaque-signature`;

describe("readActiveChapterClaim", () => {
  it("returns the claim from a well-formed token", () => {
    expect(
      readActiveChapterClaim(jwt({ sub: "u", active_chapter_id: "3d95bcb8-39dc-48c1-9c71-ec3842241561" })),
    ).toBe("3d95bcb8-39dc-48c1-9c71-ec3842241561");
  });

  it("returns null when the token carries no claim, an empty one, or a non-string", () => {
    expect(readActiveChapterClaim(jwt({ sub: "u" }))).toBeNull();
    expect(readActiveChapterClaim(jwt({ active_chapter_id: "" }))).toBeNull();
    expect(readActiveChapterClaim(jwt({ active_chapter_id: 42 }))).toBeNull();
  });

  it("returns null for nothing, a non-JWT, or an undecodable payload", () => {
    expect(readActiveChapterClaim(null)).toBeNull();
    expect(readActiveChapterClaim(undefined)).toBeNull();
    expect(readActiveChapterClaim("")).toBeNull();
    expect(readActiveChapterClaim("not-a-jwt")).toBeNull();
    expect(readActiveChapterClaim("a.b")).toBeNull();
    expect(readActiveChapterClaim("a.b.c.d")).toBeNull();
    expect(readActiveChapterClaim("h.%%%.s")).toBeNull();
  });

  it("decodes base64url payloads that need padding and carry non-ASCII", () => {
    // 'ĝ' forces multi-byte UTF-8 and an unpadded length.
    const token = jwt({ name: "Σ ĝ", active_chapter_id: "chap-Σ" });
    expect(readActiveChapterClaim(token)).toBe("chap-Σ");
  });
});
