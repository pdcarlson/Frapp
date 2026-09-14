import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveSignetPalette,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";

import {
  ACCENT_CACHE_VERSION,
  ACCENT_MAX_AGE_SECONDS,
  ACCENT_TOKEN_ORDER,
  accentTokensForScope,
  chapterAccentCss,
  parseAccentCookie,
  serializeAccentCookie,
  type AccentScope,
  type AccentTokenName,
} from "./accent-cache";

/**
 * The cached-accent row format, and the three properties the rest of the
 * feature rests on: it round-trips, it is unreadable outside the scope that
 * wrote it, and nothing that is not a hex colour can reach a stylesheet
 * through it.
 */

const SCOPE: AccentScope = {
  userId: "11111111-1111-4111-8111-111111111111",
  chapterId: "22222222-2222-4222-8222-222222222222",
};
const OTHER_MEMBER: AccentScope = { ...SCOPE, userId: "aaaa-bbbb" };
const OTHER_CHAPTER: AccentScope = { ...SCOPE, chapterId: "cccc-dddd" };

const NOW = 1_757_000_000_000;

/** A real chapter accent, straight out of the engine. */
function tokensForSeed(seed: string): Record<AccentTokenName, string> {
  return signetAccentSemanticVars(
    deriveSignetPalette(seed).palette,
  ) as Record<AccentTokenName, string>;
}

const BLUE = tokensForSeed("#3E7BFA");

/**
 * A row as the **server** receives it.
 *
 * `serializeAccentCookie` returns the percent-encoded form that goes on the
 * wire; Next's cookie store decodes every value as it parses the `Cookie`
 * header, so `parseAccentCookie`'s only production caller is handed the JSON.
 * Decoding here is what makes these tests exercise the path the server takes —
 * an earlier version fed the encoded form to a parser that then decoded again,
 * so the suite and production disagreed about the contract.
 */
function write(
  scope: AccentScope = SCOPE,
  tokens: Partial<Record<AccentTokenName, string>> = BLUE,
  now = NOW,
) {
  const value = serializeAccentCookie(scope, tokens, now);
  if (!value) throw new Error("expected a serializable row");
  return decodeURIComponent(value);
}

describe("accent cache row", () => {
  it("round-trips a real engine palette through the wire encoding", () => {
    // The full trip: serialize -> percent-encode (what lands in `document.cookie`)
    // -> Next decodes -> parse. Keeps the writer's and the reader's contracts
    // pinned to each other rather than to the test's own convenience.
    const onTheWire = serializeAccentCookie(SCOPE, BLUE, NOW)!;
    expect(onTheWire).not.toContain(";");
    const row = parseAccentCookie(decodeURIComponent(onTheWire), NOW);
    expect(accentTokensForScope(row, SCOPE)).toEqual(BLUE);
  });

  it("round-trips a real engine palette", () => {
    const row = parseAccentCookie(write(), NOW);
    expect(accentTokensForScope(row, SCOPE)).toEqual(BLUE);
  });

  it("is unreadable from another member's or another chapter's scope", () => {
    const row = parseAccentCookie(write(), NOW);
    // The whole tenancy argument, as an assertion: the row is present and
    // parseable, and still yields nothing at a scope it was not written under.
    expect(row).not.toBeNull();
    expect(accentTokensForScope(row, OTHER_MEMBER)).toBeNull();
    expect(accentTokensForScope(row, OTHER_CHAPTER)).toBeNull();
  });

  it("refuses a row from another schema version rather than coercing it", () => {
    // The stored palette is positional, so reading an old row through a new
    // ACCENT_TOKEN_ORDER would paint each role with its neighbour's colour —
    // a wrong answer that looks like a working cache.
    const row = JSON.parse(write()) as Record<string, unknown>;
    row["v"] = ACCENT_CACHE_VERSION + 1;
    expect(parseAccentCookie(JSON.stringify(row), NOW)).toBeNull();
  });

  it("expires past the retention bound, and tolerates a clock that moved back", () => {
    const ttl = ACCENT_MAX_AGE_SECONDS * 1000;
    expect(parseAccentCookie(write(), NOW + ttl)).not.toBeNull();
    expect(parseAccentCookie(write(), NOW + ttl + 1)).toBeNull();
    // `t` in the future is the machine's fault, not the row's. Refusing would
    // turn a corrected clock into a flash.
    expect(parseAccentCookie(write(), NOW - 60_000)).not.toBeNull();
  });

  it("drops a malformed cookie instead of throwing", () => {
    for (const value of [
      undefined,
      "",
      "not-json",
      "[]",
      JSON.stringify({ v: ACCENT_CACHE_VERSION }),
      // Right shape, wrong arity — a palette missing a role.
      JSON.stringify({ v: 1, u: "a", c: "b", t: NOW, p: ["#FFFFFF"] }),
    ]) {
      expect(parseAccentCookie(value, NOW)).toBeNull();
    }
  });

  it("refuses to write a partial palette", () => {
    // Same all-or-nothing rule `use-chapter-theme.ts` applies to the engine
    // map: one chapter's primary beside the house ring is worse than neither.
    const partial: Partial<Record<AccentTokenName, string>> = { ...BLUE };
    delete partial["--ring"];
    expect(serializeAccentCookie(SCOPE, partial, NOW)).toBeNull();
  });
});

describe("the value grammar is the escaping", () => {
  /**
   * `chapterAccentCss` builds a stylesheet by concatenation, so a value that
   * is not a hex colour would be a CSS injection: the cookie is writable by
   * anything that can run script on this origin.
   */
  const INJECTIONS = [
    "#fff} :root{--gold-house:#FF0000",
    "red",
    "var(--gold-house)",
    "#FFFFFF;--scrollbar-thumb:#FF0000",
    "url(https://evil.example/x)",
    "#GGGGGG",
    "#FFF",
  ];

  it("never serializes a value that is not a six-digit hex colour", () => {
    for (const value of INJECTIONS) {
      expect(
        serializeAccentCookie(SCOPE, { ...BLUE, "--primary": value }, NOW),
        `${value} must not be cacheable`,
      ).toBeNull();
    }
  });

  it("never parses one either, so a hand-written cookie cannot inject", () => {
    for (const value of INJECTIONS) {
      const row = {
        v: 1,
        u: SCOPE.userId,
        c: SCOPE.chapterId,
        t: NOW,
        p: [...ACCENT_TOKEN_ORDER].map(() => value),
      };
      expect(
        parseAccentCookie(JSON.stringify(row), NOW),
        `${value} must not survive the parse`,
      ).toBeNull();
    }
  });

  it("emits one closed rule, with no way to open a second", () => {
    const css = chapterAccentCss(BLUE);
    expect(css.match(/\{/g)).toHaveLength(1);
    expect(css.match(/\}/g)).toHaveLength(1);
    expect(css.startsWith(":root{")).toBe(true);
  });

  it("rejects a scope id carrying cookie or attribute delimiters", () => {
    for (const bad of ['a"b', "a;b", "a b", "a}b", ""]) {
      expect(serializeAccentCookie({ ...SCOPE, chapterId: bad }, BLUE, NOW)).toBeNull();
      expect(serializeAccentCookie({ ...SCOPE, userId: bad }, BLUE, NOW)).toBeNull();
    }
  });
});

describe("the no-retint boundary holds on the cached path", () => {
  /**
   * `settings-accent.spec.tsx` and `signet.css.spec.ts` guard the live path:
   * the accent bridge emits seven semantic tokens and none of the locked brand
   * families. This cache is a second writer of those same tokens, so it needs
   * the same guard — a cache that could carry one extra key would retint the
   * mark, the Ask pill or the scrollbars on every chapter that had one stored.
   */
  it("caches exactly the bridge's output — no more, no fewer", () => {
    expect([...ACCENT_TOKEN_ORDER].sort()).toEqual(Object.keys(BLUE).sort());
  });

  it("has no slot for the mark, the Ask pill or the scrollbars", () => {
    const locked = [
      "--gold-house",
      "--gold-on-house",
      "--gold-ask-fill",
      "--gold-ask-border",
      "--gold-ask-text",
      "--scrollbar-thumb",
      "--scrollbar-thumb-hover",
      "--scrollbar-track",
    ];
    const css = chapterAccentCss(BLUE);
    for (const token of locked) {
      expect(ACCENT_TOKEN_ORDER as readonly string[]).not.toContain(token);
      expect(css, `${token} must not be writable from cache`).not.toContain(token);
    }
  });
});

describe("the cascade the cached rule depends on", () => {
  /**
   * `chapter-accent-style.tsx` emits an **unlayered** `:root` rule and relies
   * on it outranking `signet.css` regardless of document order. That is only
   * true while `signet.css` keeps its `:root` block inside `@layer base` — an
   * unlayered rule beats a layered one, but two unlayered rules are decided by
   * order, and this one is rendered in the body.
   *
   * So the layering is asserted rather than assumed. Un-layer that block and
   * this fails here, loudly, instead of on a surface where the cached accent
   * quietly stops applying.
   */
  const SIGNET_CSS = readFileSync(
    `${__dirname}/../../../../packages/theme/src/signet.css`,
    "utf8",
  );

  /**
   * Brace-matched, not `[\s\S]*$`.
   *
   * The first version of this took everything from `@layer base {` to the end
   * of the file, which is true of any declaration that merely sits *after* the
   * layer opens — including one moved out of it. It would have passed on the
   * change it exists to catch.
   */
  function layerBaseBlock(css: string): string {
    const open = css.indexOf("@layer base");
    expect(open, "signet.css must still have an @layer base block").toBeGreaterThan(-1);
    const start = css.indexOf("{", open);
    let depth = 0;
    for (let i = start; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) return css.slice(start, i + 1);
      }
    }
    throw new Error("@layer base block is unbalanced");
  }

  it("signet.css declares the accent slot inside @layer base", () => {
    const layer = layerBaseBlock(SIGNET_CSS);
    for (const token of ACCENT_TOKEN_ORDER) {
      expect(
        new RegExp(`^\\s*${token}:`, "m").test(layer),
        `${token} must be declared inside @layer base`,
      ).toBe(true);
    }
  });

  it("the brace matcher is not the whole file", () => {
    // Guards the assertion above from going vacuous: if `layerBaseBlock` ever
    // returned everything, "inside the layer" would stop meaning anything.
    expect(layerBaseBlock(SIGNET_CSS).length).toBeLessThan(SIGNET_CSS.length);
  });
});
