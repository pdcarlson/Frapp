import React from "react";
import { render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The palette-application contract.
 *
 * This hook used to iterate every key of `chapters.theme_palette` onto
 * `:root`, which is how bone-calibrated legacy values reached surfaces they
 * were never validated against (#1149, and the sidebar cluster #1150/#1164).
 * The #920 shell slice made it a deliberate mapping, and the properties below
 * are the ones that keep it deliberate — none of them is observable from a
 * component test, which is why they get their own file.
 */

const useCurrentChapter = vi.fn();
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: (args: unknown) => useCurrentChapter(args),
}));

const activeChapterId = vi.fn<() => string | null>(() => "chapter-1");
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector({ activeChapterId: activeChapterId() }),
}));

/*
  The scope, not `useAuthUserId` beneath it: the hook's contract is "write only
  under a known tenant", and mocking the Supabase client to express that would
  test the mock. `null` here is the real, common state — the uid resolves in an
  effect, so every mount begins without one.
*/
const tenantScope = vi.fn<() => { userId: string; chapterId: string } | null>(
  () => ({ userId: "member-1", chapterId: "chapter-1" }),
);
vi.mock("@/lib/tenancy/scope", () => ({
  useTenantScope: () => tenantScope(),
}));

const { useChapterTheme } = await import("./use-chapter-theme");
const {
  ACCENT_CACHE_CHAPTER_ATTR,
  ACCENT_CACHE_STYLE_ID,
  ACCENT_COOKIE,
  accentTokensForScope,
  clearCachedAccent,
  parseAccentCookie,
} = await import("@/lib/theme/accent-cache");

/** A complete engine map, as `deriveSignetPalette` persists it. */
const SIGNET_KEYS = {
  "--signet-accent-primary": "#F2B72E",
  "--signet-accent-hover": "#E7AC1A",
  "--signet-accent-ring": "#86692B",
  "--signet-accent-subtle-bg": "#2C210B",
  "--signet-accent-border": "#6A5220",
  "--signet-accent-text": "#FFC64A",
  "--signet-accent-on-primary": "#2B2009",
};

/** What the legacy `derivePalette` engine wrote for a chapter with brand
 *  colours. The engine was deleted at the #920 slice-9 cutover, so nothing
 *  produces these any more — but every row saved before then still holds them.
 *  Six of the eight were composited over or validated against the bone (light)
 *  background; the two `--side-*` ones were the branded sidebar's own fill and
 *  accent. None of them may be applied to the Signet surface. This fixture is
 *  that stale row. */
const LEGACY_KEYS = {
  "--side-bg": "#6B0806",
  "--side-accent": "#C49A3A",
  "--ring": "#8B0000",
  "--mention-bg": "#FDF1E7",
  "--mention-fg": "#7A5A2F",
  "--chat-self-bubble": "#FBF5EC",
  "--reaction-active": "#7A5A2F",
  "--brand-band": "#F3E9DC",
};

/**
 * `id` is part of the payload because the cache writer compares against it:
 * `GET /v1/chapters/current` returns the chapter, so the response itself says
 * which chapter its palette belongs to. Taking that from the store instead is
 * how the guard was once a tautology.
 */
function setPalette(
  palette: Record<string, string> | undefined,
  chapterId: string | null = "chapter-1",
) {
  const id = chapterId === null ? {} : { id: chapterId };
  useCurrentChapter.mockReturnValue({
    data: palette === undefined ? { ...id } : { ...id, theme_palette: palette },
  });
}

/**
 * jsdom keeps cookies on the document, so one spec's write is the next spec's
 * stale row unless each is expired explicitly.
 */
function clearCookies(): void {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

/**
 * The row as the server would receive it.
 *
 * `document.cookie` holds the percent-encoded form; Next decodes on the way in,
 * so `parseAccentCookie` takes the JSON. Decoding here keeps this helper on the
 * same side of that boundary as production.
 */
function cachedRow() {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${ACCENT_COOKIE}=([^;]*)`),
  );
  return parseAccentCookie(
    match?.[1] ? decodeURIComponent(match[1]) : undefined,
    Date.now(),
  );
}

/**
 * The cached rule **as React renders it**, which is the whole point of the
 * helper.
 *
 * An earlier version of this file built the element with
 * `document.createElement` and appended it by hand. Every assertion below
 * passed against that, and it hid a crash: the real element is a host fiber
 * owned by `(dashboard)/layout.tsx`, so detaching it makes React throw
 * `NotFoundError` from `removeChild` the next time that subtree unmounts or
 * re-renders. A hand-built node has no fiber, so nothing could ever have thrown.
 * Rendering it through React is what makes `survives an unmount` able to fail.
 */
function CachedAccentHost({
  chapterId,
  show = true,
}: {
  chapterId: string;
  show?: boolean;
}) {
  useChapterTheme();
  return show
    ? React.createElement("style", {
        id: ACCENT_CACHE_STYLE_ID,
        [ACCENT_CACHE_CHAPTER_ATTR]: chapterId,
        dangerouslySetInnerHTML: { __html: ":root{--primary:#3E7BFA}" },
      })
    : null;
}

function cachedStyle(): HTMLStyleElement | null {
  return document.getElementById(ACCENT_CACHE_STYLE_ID) as HTMLStyleElement | null;
}

/** `not all` matches no medium, so the rule is present but inert. */
function cachedRuleApplies(): boolean {
  const style = cachedStyle();
  return style !== null && style.media !== "not all";
}

function inlineTokens(): Record<string, string> {
  const style = document.documentElement.style;
  const out: Record<string, string> = {};
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    out[name] = style.getPropertyValue(name);
  }
  return out;
}

describe("useChapterTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.getElementById(ACCENT_CACHE_STYLE_ID)?.remove();
    clearCookies();
    activeChapterId.mockReturnValue("chapter-1");
    tenantScope.mockReturnValue({ userId: "member-1", chapterId: "chapter-1" });
    vi.clearAllMocks();
  });

  it("maps the engine roles onto the semantic tokens the stylesheet defines", () => {
    setPalette(SIGNET_KEYS);
    renderHook(() => useChapterTheme());

    expect(inlineTokens()).toEqual({
      "--primary": "#F2B72E",
      "--primary-hover": "#E7AC1A",
      "--primary-foreground": "#2B2009",
      "--ring": "#86692B",
      "--accent-subtle": "#2C210B",
      "--accent-border": "#6A5220",
      "--accent-text": "#FFC64A",
    });
  });

  it("never applies a legacy token left in a stale stored row", () => {
    // The whole class of #1149/#1150 defect: these values are composited over
    // the bone background, so any of them landing on the Signet surface paints
    // a near-white fill or an unvalidated ring on #0E0D0B.
    //
    // Deleting the writer did not retire this guard — it is what made the
    // deletion safe to ship without a data migration. `chapters.theme_palette`
    // is unconstrained jsonb: the #1165 stale-palette sweep replaces each
    // stored map whole, but a row keeps these keys until that sweep reaches
    // it, and nothing stops a non-role key being written to the column
    // afterwards (accent-engine.md §4 Storage), so the hook stays an
    // allow-list.
    setPalette({ ...LEGACY_KEYS, ...SIGNET_KEYS });
    renderHook(() => useChapterTheme());

    const applied = inlineTokens();
    for (const token of Object.keys(LEGACY_KEYS)) {
      if (token === "--ring") continue; // written, but from the engine — asserted below
      expect(applied[token], `${token} must not reach :root`).toBeUndefined();
    }
    expect(applied["--ring"]).toBe(SIGNET_KEYS["--signet-accent-ring"]);
  });

  it("applies nothing when the engine map is incomplete, leaving the house defaults", () => {
    // A row persisted before the Signet keys existed (#1165). A half-applied
    // map is worse than none: the stylesheet's house-gold defaults are
    // internally consistent, a mix of one chapter's primary and the house
    // ring is not.
    const partial: Record<string, string> = { ...SIGNET_KEYS };
    delete partial["--signet-accent-ring"];
    setPalette({ ...partial, ...LEGACY_KEYS });
    renderHook(() => useChapterTheme());

    expect(inlineTokens()).toEqual({});
  });

  it("does nothing for an absent or empty palette", () => {
    setPalette(undefined);
    const first = renderHook(() => useChapterTheme());
    expect(inlineTokens()).toEqual({});
    first.unmount();

    setPalette({});
    renderHook(() => useChapterTheme());
    expect(inlineTokens()).toEqual({});
  });

  it("removes exactly what it applied on unmount", () => {
    setPalette(SIGNET_KEYS);
    const { unmount } = renderHook(() => useChapterTheme());
    expect(Object.keys(inlineTokens())).toHaveLength(7);

    unmount();
    expect(inlineTokens()).toEqual({});
  });

  it("swaps cleanly when the chapter changes", () => {
    setPalette(SIGNET_KEYS);
    const { rerender } = renderHook(() => useChapterTheme());

    activeChapterId.mockReturnValue("chapter-2");
    setPalette({
      ...SIGNET_KEYS,
      "--signet-accent-primary": "#D9596F",
      "--signet-accent-text": "#F3A8B6",
    });
    rerender();

    const applied = inlineTokens();
    expect(applied["--primary"]).toBe("#D9596F");
    expect(applied["--accent-text"]).toBe("#F3A8B6");
    // No token from the outgoing chapter survives the swap.
    expect(Object.keys(applied)).toHaveLength(7);
  });

  describe("recording the palette for the next cold load", () => {
    /**
     * The cache's only writer. `accent-cache.ts` has the argument for why the
     * row exists at all; these are the conditions under which this hook is
     * willing to create one.
     */
    it("caches exactly the tokens it applied", () => {
      setPalette(SIGNET_KEYS);
      renderHook(() => useChapterTheme());

      const tokens = accentTokensForScope(cachedRow(), {
        userId: "member-1",
        chapterId: "chapter-1",
      });
      expect(tokens).toEqual(inlineTokens());
    });

    it("writes nothing until the session resolves", () => {
      // `useAuthUserId` is `null` on every mount until its effect lands. A row
      // written then would carry no member, and there is no member to write.
      tenantScope.mockReturnValue(null);
      setPalette(SIGNET_KEYS);
      renderHook(() => useChapterTheme());

      expect(cachedRow()).toBeNull();
      // The live paint does not wait on the scope, though — only the cache does.
      expect(Object.keys(inlineTokens())).toHaveLength(7);
    });

    it("writes nothing for an incomplete engine map", () => {
      // A row persisted before the Signet keys existed (#1165). The same
      // all-or-nothing rule the apply path uses: half a palette is worse than
      // none, and caching half would make it worse for longer.
      const partial: Record<string, string> = { ...SIGNET_KEYS };
      delete partial["--signet-accent-ring"];
      setPalette(partial);
      renderHook(() => useChapterTheme());

      expect(cachedRow()).toBeNull();
    });

    it("never caches a palette the response does not vouch for", () => {
      // The hazard is one `placeholderData: keepPreviousData` away: `data` would
      // then hold the OUTGOING chapter's palette while the scope names the
      // incoming one, and the row written would say chapter-2 and hold
      // chapter-1's colours — a wrong answer that looks like a working cache.
      // The response's own `id` is the only thing that can tell them apart.
      setPalette(SIGNET_KEYS, "chapter-1");
      activeChapterId.mockReturnValue("chapter-2");
      tenantScope.mockReturnValue({ userId: "member-1", chapterId: "chapter-2" });
      renderHook(() => useChapterTheme());

      expect(cachedRow()).toBeNull();
    });

    it("never caches a response that names no chapter at all", () => {
      // Absence is not permission: a payload with no `id` cannot say which
      // chapter it describes, so there is nothing to file it under.
      setPalette(SIGNET_KEYS, null);
      renderHook(() => useChapterTheme());

      expect(cachedRow()).toBeNull();
    });
  });

  describe("handing over from the server-rendered cached accent", () => {
    /**
     * The cached rule is an unlayered `:root` block and the live palette is an
     * inline style on `<html>`, so for the chapter it was rendered for the
     * handover needs no code at all — the cascade does it. A chapter *change*
     * is the case that does, because several paths switch chapter in place
     * with no document load.
     */
    it("leaves the cached rule applying while it names the live chapter", () => {
      setPalette(SIGNET_KEYS);
      render(React.createElement(CachedAccentHost, { chapterId: "chapter-1" }));

      expect(cachedRuleApplies()).toBe(true);
    });

    it("stops it applying the moment the chapter changes in place", () => {
      setPalette(SIGNET_KEYS);
      const view = render(
        React.createElement(CachedAccentHost, { chapterId: "chapter-1" }),
      );
      expect(cachedRuleApplies()).toBe(true);

      // An in-place switch: the store moves, no navigation, and the new
      // chapter's palette has not arrived yet.
      activeChapterId.mockReturnValue("chapter-2");
      tenantScope.mockReturnValue({ userId: "member-1", chapterId: "chapter-2" });
      setPalette(undefined);
      view.rerender(
        React.createElement(CachedAccentHost, { chapterId: "chapter-1" }),
      );

      // Otherwise the apply effect's cleanup would uncover chapter-1's cached
      // accent — this change's own fix, painting the bug it exists to prevent.
      expect(cachedRuleApplies()).toBe(false);
      expect(inlineTokens()).toEqual({});
    });

    it("turns back on when the claim settles a stale store", () => {
      // Cold load on a browser whose persisted chapter is stale — switched on
      // another device. The server rendered from the token's claim, so the rule
      // in the document is RIGHT and the store is wrong; `useClaimChapterSync`
      // is one auth event away from correcting it. A retire that destroyed the
      // element here would hand this member the house-gold flash by way of the
      // fix, with nothing to see.
      setPalette(undefined);
      activeChapterId.mockReturnValue("chapter-stale");
      const view = render(
        React.createElement(CachedAccentHost, { chapterId: "chapter-1" }),
      );
      expect(cachedRuleApplies()).toBe(false);

      activeChapterId.mockReturnValue("chapter-1");
      view.rerender(
        React.createElement(CachedAccentHost, { chapterId: "chapter-1" }),
      );
      expect(cachedRuleApplies()).toBe(true);
    });

    it("keeps it applying while the chapter is unknown", () => {
      // `null` is "not resolved yet", never "a different chapter".
      activeChapterId.mockReturnValue(null);
      setPalette(undefined);
      render(React.createElement(CachedAccentHost, { chapterId: "chapter-1" }));

      expect(cachedRuleApplies()).toBe(true);
    });

    it("stops applying once the identity changes, even with no chapter to compare", () => {
      /*
        The cross-tab sign-in. Member B signs in in another tab with no chapter
        of their own; auth-js broadcasts it, `useClaimChapterSync` writes `null`
        into this tab's store, and the live inline palette is stripped — so the
        previous member's chapter accent, sitting in this rule, would be the
        only accent source left on screen. `clearCachedAccent` runs on that
        event and strips the chapter attribute, which is what lets this effect
        tell the case apart from a cold load that has simply not resolved yet.
      */
      setPalette(SIGNET_KEYS);
      const view = render(
        React.createElement(CachedAccentHost, { chapterId: "chapter-1" }),
      );
      expect(cachedRuleApplies()).toBe(true);

      clearCachedAccent();
      expect(cachedRuleApplies()).toBe(false);

      activeChapterId.mockReturnValue(null);
      tenantScope.mockReturnValue(null);
      setPalette(undefined);
      view.rerender(
        React.createElement(CachedAccentHost, { chapterId: "chapter-1" }),
      );

      // Still off: a rule that claims no chapter is nobody's.
      expect(cachedRuleApplies()).toBe(false);
      expect(inlineTokens()).toEqual({});
    });

    it("survives an unmount and a re-render after the chapter moved", () => {
      // The element is React's. Detaching it rather than disabling it makes
      // React throw `NotFoundError` from `removeChild` on the next unmount or
      // re-render of the layout that owns it — a whole-dashboard error screen
      // on the next sign-out or hard refresh. Verified: with `cached.remove()`
      // in place of the `media` toggle, both expectations below throw.
      setPalette(SIGNET_KEYS);
      const view = render(
        React.createElement(CachedAccentHost, { chapterId: "chapter-1" }),
      );

      activeChapterId.mockReturnValue("chapter-2");
      setPalette(undefined);
      view.rerender(
        React.createElement(CachedAccentHost, { chapterId: "chapter-1" }),
      );

      expect(() =>
        view.rerender(
          React.createElement(CachedAccentHost, {
            chapterId: "chapter-1",
            show: false,
          }),
        ),
      ).not.toThrow();
      expect(() => view.unmount()).not.toThrow();
    });
  });
});
