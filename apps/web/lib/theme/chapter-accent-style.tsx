import {
  ACCENT_CACHE_CHAPTER_ATTR,
  ACCENT_CACHE_STYLE_ID,
  chapterAccentCss,
  type CachedAccentPaint,
} from "./accent-cache";

/**
 * The element that carries a remembered chapter accent into the first paint.
 *
 * ## Why a `<style>` and not an inline `style` attribute
 *
 * An inline `style` on a wrapper element would win — custom properties inherit,
 * so every descendant would read the cached values. That is exactly the
 * problem: `lib/hooks/use-chapter-theme.ts` writes the authoritative palette as
 * an inline style on `<html>`, an *ancestor* of any wrapper this layout could
 * render, and an ancestor's inline value loses to a descendant's. The cache
 * would shadow the network answer instead of yielding to it, permanently.
 *
 * A stylesheet rule has the opposite ordering, and it is the ordering this
 * needs. The three writers of the accent slot stack in exactly one way:
 *
 * | Source | Selector | Beaten by |
 * | --- | --- | --- |
 * | `signet.css` — house default | `@layer base :root` | anything unlayered |
 * | this element — last known | `:root`, unlayered | any inline style |
 * | `use-chapter-theme.ts` — live | inline on `<html>` | nothing |
 *
 * The first two do not depend on document order: an unlayered rule beats a
 * layered one whatever the order, which `signet.css` makes true by declaring
 * its `:root` block inside `@layer base`. So the cached accent is guaranteed to
 * replace the house default, and equally guaranteed to step aside the moment
 * the real palette lands. Nothing has to be removed for the handover — the one
 * case that does need removing is a chapter *change*, which `use-chapter-theme`
 * handles and explains.
 *
 * The CSS text and the two DOM constants live in `accent-cache.ts`, not here,
 * so the client hook can share them without importing this file — it would
 * reach `next/headers` through the server read otherwise.
 *
 * ## Why it is rendered inside the dashboard and not the root layout
 *
 * `spec/ui/web-dashboard/README.md`: a pre-auth screen has no tenant, so the
 * accent slot holds the house default there, and the mark may not take a
 * chapter accent at all. Rendering this above the `(dashboard)` group would
 * paint a chapter's colour on `/sign-in`.
 */
export function ChapterAccentStyle({
  paint,
}: {
  paint: CachedAccentPaint | null;
}) {
  if (!paint) return null;
  return (
    <style
      id={ACCENT_CACHE_STYLE_ID}
      /*
        The chapter id, and deliberately not the member id. The client's only
        question is "is this style block for the chapter I am now in" — two
        members of the same chapter share an accent, so the uid would add a
        value to the DOM that answers nothing. The uid still gates the *read*,
        server-side, where it matters.
      */
      {...{ [ACCENT_CACHE_CHAPTER_ATTR]: paint.chapterId }}
      dangerouslySetInnerHTML={{ __html: chapterAccentCss(paint.tokens) }}
    />
  );
}
