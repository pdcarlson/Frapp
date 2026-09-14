import { renderHook } from "@testing-library/react";
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

function setPalette(palette: Record<string, string> | undefined) {
  useCurrentChapter.mockReturnValue({
    data: palette === undefined ? {} : { theme_palette: palette },
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

function cachedRow() {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${ACCENT_COOKIE}=([^;]*)`),
  );
  return parseAccentCookie(match?.[1], Date.now());
}

/** A server-rendered cached-accent rule, as `ChapterAccentStyle` emits one. */
function renderCachedStyleFor(chapterId: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.id = ACCENT_CACHE_STYLE_ID;
  style.setAttribute(ACCENT_CACHE_CHAPTER_ATTR, chapterId);
  style.textContent = ":root{--primary:#3E7BFA}";
  document.head.append(style);
  return style;
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
    // Deleting the writer did not retire this guard — it is what makes the
    // deletion safe to ship without a data migration. `chapters.theme_palette`
    // is unconstrained jsonb and no backfill prunes it, so these keys outlive
    // the engine indefinitely and the hook stays an allow-list.
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

    it("never caches under a scope whose chapter the palette is not for", () => {
      // The store has moved but the scope has not yet — write the row now and
      // it files chapter-1's palette under chapter-2's key.
      setPalette(SIGNET_KEYS);
      activeChapterId.mockReturnValue("chapter-2");
      renderHook(() => useChapterTheme());

      expect(cachedRow()).toBeNull();
    });
  });

  describe("handing over from the server-rendered cached accent", () => {
    /**
     * The cached rule is an unlayered `:root` block and the live palette is an
     * inline style on `<html>`, so for the chapter it was rendered for the
     * handover needs no code at all — the cascade does it. A chapter *change*
     * is the case that does, because `/join` and the onboarding wizard switch
     * in place with no document load.
     */
    it("leaves the cached rule alone while it names the live chapter", () => {
      renderCachedStyleFor("chapter-1");
      setPalette(SIGNET_KEYS);
      renderHook(() => useChapterTheme());

      expect(document.getElementById(ACCENT_CACHE_STYLE_ID)).not.toBeNull();
    });

    it("removes it the moment the chapter changes in place", () => {
      renderCachedStyleFor("chapter-1");
      setPalette(SIGNET_KEYS);
      const { rerender } = renderHook(() => useChapterTheme());
      expect(document.getElementById(ACCENT_CACHE_STYLE_ID)).not.toBeNull();

      // An in-place switch: the store moves, no navigation, and the new
      // chapter's palette has not arrived yet.
      activeChapterId.mockReturnValue("chapter-2");
      tenantScope.mockReturnValue({ userId: "member-1", chapterId: "chapter-2" });
      setPalette(undefined);
      rerender();

      // Otherwise the apply effect's cleanup would uncover chapter-1's cached
      // accent — this change's own fix, painting the bug it exists to prevent.
      expect(document.getElementById(ACCENT_CACHE_STYLE_ID)).toBeNull();
      expect(inlineTokens()).toEqual({});
    });

    it("keeps it while the chapter is unknown", () => {
      // `null` is "not resolved yet", never "a different chapter".
      renderCachedStyleFor("chapter-1");
      activeChapterId.mockReturnValue(null);
      setPalette(undefined);
      renderHook(() => useChapterTheme());

      expect(document.getElementById(ACCENT_CACHE_STYLE_ID)).not.toBeNull();
    });
  });
});
