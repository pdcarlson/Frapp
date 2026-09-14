import { describe, expect, it } from "vitest";

import { readAccessTokenFromCookies } from "./access-token-cookie";

/**
 * The Supabase cookie shapes, pinned.
 *
 * This module reimplements a format `@supabase/ssr` does not export
 * (`dist/main/cookies.js`), so it is the one part of the accent cache that can
 * rot silently when Supabase moves. These cases exist so that day is a red
 * test rather than a cache that quietly stops working — and the last
 * `describe` pins the failure mode, which is `null` and never a throw.
 */

const TOKEN = "header.payload.signature";

function sessionJson(accessToken = TOKEN) {
  return JSON.stringify({
    access_token: accessToken,
    refresh_token: "r",
    expires_at: 1,
    user: { id: "u" },
  });
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("readAccessTokenFromCookies", () => {
  it("reads a plain single cookie", () => {
    expect(
      readAccessTokenFromCookies([
        { name: "sb-abcdefgh-auth-token", value: sessionJson() },
      ]),
    ).toBe(TOKEN);
  });

  it("reads a base64url-prefixed cookie", () => {
    expect(
      readAccessTokenFromCookies([
        {
          name: "sb-abcdefgh-auth-token",
          value: `base64-${base64UrlEncode(sessionJson())}`,
        },
      ]),
    ).toBe(TOKEN);
  });

  it("reassembles chunks in index order, not jar order", () => {
    const json = sessionJson();
    const split = Math.floor(json.length / 2);
    expect(
      readAccessTokenFromCookies([
        { name: "sb-abcdefgh-auth-token.1", value: json.slice(split) },
        { name: "sb-abcdefgh-auth-token.0", value: json.slice(0, split) },
      ]),
    ).toBe(TOKEN);
  });

  it("reassembles more than ten chunks numerically", () => {
    // A string sort puts `.10` between `.1` and `.2`, which reassembles a
    // valid-looking but scrambled JSON. Sessions do reach eleven chunks.
    const json = sessionJson(`${TOKEN}${"x".repeat(200)}`);
    const size = Math.ceil(json.length / 11);
    const chunks = Array.from({ length: 11 }, (_, i) => ({
      name: `sb-abcdefgh-auth-token.${i}`,
      value: json.slice(i * size, (i + 1) * size),
    }));
    expect(readAccessTokenFromCookies(chunks.reverse())).toBe(
      `${TOKEN}${"x".repeat(200)}`,
    );
  });

  it("prefers an unchunked cookie over leftover chunks beside it", () => {
    // A session that shrank below the chunk threshold can leave `.0` behind.
    // Concatenating both would produce garbage.
    expect(
      readAccessTokenFromCookies([
        { name: "sb-abcdefgh-auth-token", value: sessionJson() },
        { name: "sb-abcdefgh-auth-token.0", value: '{"access_token":"stale"' },
      ]),
    ).toBe(TOKEN);
  });

  it("reads the legacy array shape", () => {
    expect(
      readAccessTokenFromCookies([
        { name: "sb-abcdefgh-auth-token", value: JSON.stringify([TOKEN, "r"]) },
      ]),
    ).toBe(TOKEN);
  });

  it("ignores the PKCE verifier keys stored beside the session", () => {
    expect(
      readAccessTokenFromCookies([
        { name: "sb-abcdefgh-auth-token-code-verifier", value: "v" },
        { name: "sb-abcdefgh-auth-token-flows-code-verifier", value: "v" },
        { name: "sb-abcdefgh-auth-token", value: sessionJson() },
      ]),
    ).toBe(TOKEN);
  });

  it("ignores unrelated cookies", () => {
    expect(
      readAccessTokenFromCookies([
        { name: "signet_nav_collapsed", value: "1" },
        { name: "signet_chapter_accent", value: "{}" },
      ]),
    ).toBeNull();
  });
});

describe("it fails closed, never loudly", () => {
  /**
   * `null` is "no cached accent", which is one ordinary cold load — the
   * behaviour that shipped before this cache existed. A throw here would fail
   * a dashboard render to save a flash.
   */
  it.each([
    ["an empty jar", []],
    ["a non-JSON value", [{ name: "sb-a-auth-token", value: "nonsense" }]],
    ["truncated base64", [{ name: "sb-a-auth-token", value: "base64-!!!!" }]],
    [
      "JSON with no access_token",
      [{ name: "sb-a-auth-token", value: '{"refresh_token":"r"}' }],
    ],
    [
      "a non-string access_token",
      [{ name: "sb-a-auth-token", value: '{"access_token":42}' }],
    ],
    ["an empty access_token", [{ name: "sb-a-auth-token", value: '{"access_token":""}' }]],
    ["an empty array", [{ name: "sb-a-auth-token", value: "[]" }]],
    ["a JSON scalar", [{ name: "sb-a-auth-token", value: '"token"' }]],
    ["chunks that do not reassemble", [{ name: "sb-a-auth-token.0", value: '{"access' }]],
  ])("returns null for %s", (_label, cookies) => {
    expect(() => readAccessTokenFromCookies(cookies)).not.toThrow();
    expect(readAccessTokenFromCookies(cookies)).toBeNull();
  });
});
