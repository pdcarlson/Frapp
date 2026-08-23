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

const { useChapterTheme } = await import("./use-chapter-theme");

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
 *  produces these any more — but every row saved before then still holds them,
 *  and all of it is composited over the bone (light) background, so none of it
 *  may be applied. This fixture is that stale row. */
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
    activeChapterId.mockReturnValue("chapter-1");
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
});
