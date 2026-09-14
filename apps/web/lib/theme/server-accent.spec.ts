import { readFileSync } from "node:fs";
import type { AccentTokenName } from "./accent-cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveSignetPalette,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";

/**
 * The server read, end to end: a cookie written by the client in one session,
 * and the accent the next cold load paints because of it.
 *
 * This is the file that fails if the flash comes back. `signet.css` bakes the
 * house-gold accent slot, so "nothing painted from cache" and "painted in
 * another chapter's gold" are the same outcome — which is why the assertions
 * below are two-sided: the chapter's own values must be present *and* the
 * house values must be gone.
 */

/**
 * The jar as Next delivers it: **values already URL-decoded**.
 *
 * `RequestCookies` runs `decodeURIComponent` on every value while parsing the
 * `Cookie` header, so a server component never sees the percent-encoded form
 * the browser sent. The helpers below decode on the way in for that reason —
 * feeding the encoded shape here would test a path the server does not take.
 */
const cookieJar = vi.fn<() => Array<{ name: string; value: string }>>(() => []);

vi.mock("next/headers", () => ({
  cookies: async () => {
    const all = cookieJar();
    return {
      getAll: () => all,
      get: (name: string) => all.find((cookie) => cookie.name === name),
    };
  },
}));

/*
  A hosted project URL, so the cookie name the reader derives is the realistic
  `sb-<ref>-auth-token` rather than the local stack's `sb-127-auth-token`. The
  reader anchors to this project's ref on purpose — a cookie named for any other
  ref is another project's, or an attacker's.
*/
const SUPABASE_URL = "https://abcdefgh.supabase.co";
const AUTH_COOKIE_NAME = "sb-abcdefgh-auth-token";

const { readCachedAccentPaint } = await import("./server-accent");
const {
  ACCENT_COOKIE,
  ACCENT_TOKEN_ORDER,
  chapterAccentCss,
  serializeAccentCookie,
} = await import("./accent-cache");

const USER = "11111111-1111-4111-8111-111111111111";
const CHAPTER_A = "22222222-2222-4222-8222-222222222222";
const CHAPTER_B = "33333333-3333-4333-8333-333333333333";

/** The seed a chapter chose — deliberately nothing like the house gold. */
const CHAPTER_A_SEED = "#3E7BFA";
const CHAPTER_A_TOKENS = signetAccentSemanticVars(
  deriveSignetPalette(CHAPTER_A_SEED).palette,
) as Record<AccentTokenName, string>;

/**
 * What `signet.css` paints when nothing overrides it, read from the stylesheet
 * rather than restated — the point of the assertions below is that these are
 * what a member must NOT see, and a hand-copied list could drift into agreeing
 * with the code by accident.
 */
const HOUSE_DEFAULTS = (() => {
  const css = readFileSync(
    `${__dirname}/../../../../packages/theme/src/signet.css`,
    "utf8",
  );
  const values: Record<string, string> = {};
  for (const token of ACCENT_TOKEN_ORDER) {
    const match = css.match(new RegExp(`^\\s*${token}:\\s*([^;]+);`, "m"));
    if (!match?.[1]) throw new Error(`signet.css has no ${token}`);
    values[token] = match[1].trim();
  }
  return values;
})();

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.sig`;
}

function session(sub: string | null, chapter: string | null) {
  const claims: Record<string, unknown> = {};
  if (sub) claims["sub"] = sub;
  if (chapter) claims["active_chapter_id"] = chapter;
  return {
    name: AUTH_COOKIE_NAME,
    value: JSON.stringify({ access_token: jwt(claims) }),
  };
}

function accentCookie(
  userId: string,
  chapterId: string,
  tokens: Record<AccentTokenName, string> = CHAPTER_A_TOKENS,
) {
  const value = serializeAccentCookie({ userId, chapterId }, tokens, Date.now());
  if (!value) throw new Error("expected a serializable row");
  return { name: ACCENT_COOKIE, value: decodeURIComponent(value) };
}

describe("the cached accent reaches first paint", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    cookieJar.mockReturnValue([]);
  });

  /**
   * THE regression test for this change.
   *
   * A chapter with its own accent, cached from a previous session, opening
   * cold. If the server read is removed, short-circuited, or stops matching
   * the row, `paint` is `null`, the emitted CSS is empty and the shell paints
   * `signet.css`'s house gold — so both halves below fail together.
   */
  it("paints the chapter's own seed, not the house default", async () => {
    cookieJar.mockReturnValue([
      session(USER, CHAPTER_A),
      accentCookie(USER, CHAPTER_A),
    ]);

    const paint = await readCachedAccentPaint();
    expect(paint).not.toBeNull();
    expect(paint!.chapterId).toBe(CHAPTER_A);
    expect(paint!.tokens).toEqual(CHAPTER_A_TOKENS);

    const css = chapterAccentCss(paint!.tokens);
    for (const token of ACCENT_TOKEN_ORDER) {
      expect(
        css,
        `${token} must paint the chapter's value at first paint`,
      ).toContain(`${token}:${CHAPTER_A_TOKENS[token]}`);
      expect(
        css,
        `${token} must not be left at the house default`,
      ).not.toContain(`${token}:${HOUSE_DEFAULTS[token]}`);
    }
  });

  it("the fixture is a real flash: every role differs from the house", () => {
    // Guards the test above from going vacuous. If a future house seed
    // happened to derive to this chapter's palette, the `not.toContain`
    // assertions would pass for the wrong reason.
    for (const token of ACCENT_TOKEN_ORDER) {
      expect(CHAPTER_A_TOKENS[token]).not.toBe(HOUSE_DEFAULTS[token]);
    }
  });
});

describe("a row is only readable at the scope it was written under", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    cookieJar.mockReturnValue([]);
  });

  it("chapter B never shows chapter A's accent", async () => {
    // The row is for chapter A; this request's token says chapter B. There is
    // no scope under which A's row is returned — B falls back to the house
    // default, which is the honest answer until B's own palette arrives.
    cookieJar.mockReturnValue([
      session(USER, CHAPTER_B),
      accentCookie(USER, CHAPTER_A),
    ]);
    expect(await readCachedAccentPaint()).toBeNull();
  });

  it("another member never shows the previous member's chapter accent", async () => {
    // The case the client-side clears cannot cover: A's browser closed without
    // signing out, B signs in, and the redirect into the dashboard is a full
    // document load — nothing is hydrated, so no effect has run to clear it.
    cookieJar.mockReturnValue([
      session("99999999-9999-4999-8999-999999999999", CHAPTER_A),
      accentCookie(USER, CHAPTER_A),
    ]);
    expect(await readCachedAccentPaint()).toBeNull();
  });

  it("paints nothing with no session, no chapter claim, or no row", async () => {
    for (const jar of [
      [accentCookie(USER, CHAPTER_A)],
      [session(null, CHAPTER_A), accentCookie(USER, CHAPTER_A)],
      [session(USER, null), accentCookie(USER, CHAPTER_A)],
      [session(USER, CHAPTER_A)],
    ]) {
      cookieJar.mockReturnValue(jar);
      expect(await readCachedAccentPaint()).toBeNull();
    }
  });

  it("survives a garbage jar without throwing the render", async () => {
    cookieJar.mockReturnValue([
      { name: AUTH_COOKIE_NAME, value: "not-json" },
      { name: ACCENT_COOKIE, value: "{{{" },
    ]);
    await expect(readCachedAccentPaint()).resolves.toBeNull();
  });

  it("ignores a session cookie named for another project's ref", async () => {
    /*
      The sibling-subdomain case. On a shared parent domain, script on another
      host can set a `Domain=`-scoped cookie — and an earlier revision matched
      any `sb-<ref>-auth-token`, preferring an unchunked one over the victim's
      real, chunked session. Since the token is decoded and never verified, the
      attacker supplied both halves of the key: a `sub` and `active_chapter_id`
      of their choosing plus a row to match, and the victim's dashboard
      first-painted in colours they had picked.

      Anchoring the name to this project's ref is what closes it. The forged
      cookie below is simply not this project's session.
    */
    cookieJar.mockReturnValue([
      { name: "sb-attacker-auth-token", value: JSON.stringify({ access_token: jwt({ sub: USER, active_chapter_id: CHAPTER_A }) }) },
      accentCookie(USER, CHAPTER_A),
    ]);
    expect(await readCachedAccentPaint()).toBeNull();
  });

  it("paints nothing when the project URL is absent or unparseable", async () => {
    for (const url of ["", "not a url"]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      cookieJar.mockReturnValue([
        session(USER, CHAPTER_A),
        accentCookie(USER, CHAPTER_A),
      ]);
      expect(await readCachedAccentPaint()).toBeNull();
    }
  });
});
