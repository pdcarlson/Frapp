import { describe, expect, it, vi } from "vitest";

import {
  readAccessTokenFromCookies,
  supabaseAuthCookieName,
} from "./access-token-cookie";

/** This project's cookie name, as supabase-js derives it. */
const NAME = "sb-abcdefgh-auth-token";
const read = (cookies: Array<{ name: string; value: string }>) =>
  readAccessTokenFromCookies(cookies, NAME);

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
      read([
        { name: NAME, value: sessionJson() },
      ]),
    ).toBe(TOKEN);
  });

  it("reads a base64url-prefixed cookie", () => {
    expect(
      read([
        {
          name: NAME,
          value: `base64-${base64UrlEncode(sessionJson())}`,
        },
      ]),
    ).toBe(TOKEN);
  });

  it("reassembles chunks in index order, not jar order", () => {
    const json = sessionJson();
    const split = Math.floor(json.length / 2);
    expect(
      read([
        { name: `${NAME}.1`, value: json.slice(split) },
        { name: `${NAME}.0`, value: json.slice(0, split) },
      ]),
    ).toBe(TOKEN);
  });

  it("reassembles more than ten chunks numerically", () => {
    // A string sort puts `.10` between `.1` and `.2`, which reassembles a
    // valid-looking but scrambled JSON. Sessions do reach eleven chunks.
    const json = sessionJson(`${TOKEN}${"x".repeat(200)}`);
    const size = Math.ceil(json.length / 11);
    const chunks = Array.from({ length: 11 }, (_, i) => ({
      name: `${NAME}.${i}`,
      value: json.slice(i * size, (i + 1) * size),
    }));
    expect(read(chunks.reverse())).toBe(
      `${TOKEN}${"x".repeat(200)}`,
    );
  });

  it("prefers an unchunked cookie over leftover chunks beside it", () => {
    // A session that shrank below the chunk threshold can leave `.0` behind.
    // Concatenating both would produce garbage.
    expect(
      read([
        { name: NAME, value: sessionJson() },
        { name: `${NAME}.0`, value: '{"access_token":"stale"' },
      ]),
    ).toBe(TOKEN);
  });

  it("reads the legacy array shape", () => {
    expect(
      read([
        { name: NAME, value: JSON.stringify([TOKEN, "r"]) },
      ]),
    ).toBe(TOKEN);
  });

  it("ignores the PKCE verifier keys stored beside the session", () => {
    expect(
      read([
        { name: `${NAME}-code-verifier`, value: "v" },
        { name: `${NAME}-flows-code-verifier`, value: "v" },
        { name: NAME, value: sessionJson() },
      ]),
    ).toBe(TOKEN);
  });

  it("ignores unrelated cookies", () => {
    expect(
      read([
        { name: "signet_nav_collapsed", value: "1" },
        { name: "signet_chapter_accent", value: "{}" },
      ]),
    ).toBeNull();
  });
});

describe("supabaseAuthCookieName", () => {
  /**
   * The rule supabase-js uses for its storage key:
   * `` sb-${new URL(url).hostname.split(".")[0]}-auth-token ``. Reproduced here
   * because it is not exported, and pinned because the whole point of anchoring
   * to it is that a cookie named for any *other* ref is not this project's
   * session — see the module header.
   */
  it.each([
    ["https://abcdefgh.supabase.co", "sb-abcdefgh-auth-token"],
    ["https://abcdefgh.supabase.co/", "sb-abcdefgh-auth-token"],
    ["http://127.0.0.1:54321", "sb-127-auth-token"],
    ["http://localhost:54321", "sb-localhost-auth-token"],
  ])("derives %s as %s", (url, expected) => {
    expect(supabaseAuthCookieName(url)).toBe(expected);
  });

  it.each([undefined, "", "not a url"])("is null for %s", (url) => {
    expect(supabaseAuthCookieName(url)).toBeNull();
  });

  it("reads the project URL from the env when not given one", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://zyxwvuts.supabase.co");
    expect(supabaseAuthCookieName()).toBe("sb-zyxwvuts-auth-token");
    vi.unstubAllEnvs();
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
    ["a non-JSON value", [{ name: NAME, value: "nonsense" }]],
    ["truncated base64", [{ name: NAME, value: "base64-!!!!" }]],
    [
      "JSON with no access_token",
      [{ name: NAME, value: '{"refresh_token":"r"}' }],
    ],
    [
      "a non-string access_token",
      [{ name: NAME, value: '{"access_token":42}' }],
    ],
    ["an empty access_token", [{ name: NAME, value: '{"access_token":""}' }]],
    ["an empty array", [{ name: NAME, value: "[]" }]],
    ["a JSON scalar", [{ name: NAME, value: '"token"' }]],
    ["chunks that do not reassemble", [{ name: `${NAME}.0`, value: '{"access' }]],
  ])("returns null for %s", (_label, cookies) => {
    expect(() => read(cookies)).not.toThrow();
    expect(read(cookies)).toBeNull();
  });
});
