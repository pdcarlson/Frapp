import { useMemo } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { resolveChapterAccentColor } from "@repo/theme/accent";
import { useFrappTheme } from "./theme";

export type ChapterBranding = {
  /**
   * The accent to paint chapter-scoped UI with. Never null, so call sites need
   * no fallback of their own.
   *
   * Normally this is `--signet-accent-text` — step 11 of the generated scale —
   * read from the chapter's served palette. It falls back to the legacy
   * per-surface resolver only for a chapter whose palette has not been
   * recomputed since the Signet map landed.
   */
  accent: string;
  /**
   * True when the legacy fallback ran *and* the chapter's own colour failed AA,
   * so the brand token stood in. Always false on the engine path: step 11 is
   * contrast-correct by construction (accent-engine.md §8), so there is nothing
   * for a runtime check to catch.
   */
  accentFallbackApplied: boolean;
  /** Signed URL from `GET /v1/chapters/current`, or null when no logo is set. */
  logoUrl: string | null;
  /** Falls back to text branding when there is no logo (spec/behavior/branding.md). */
  chapterName: string | null;
};

function readString(
  source: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Per-chapter branding for the mobile member surface.
 *
 * Chapter identity is keyed off the active chapter the API client already
 * resolves, so a chapter change re-renders every consumer without a restart —
 * no separate invalidation, and nothing to reset on sign-out.
 *
 * ## The accent comes from the generated scale, not the raw seed
 *
 * `accent-engine.md` §1 and `spec/ui/mobile/README.md` both say it outright:
 * "the raw seed MUST NOT paint UI directly", only generated steps may. This
 * used to paint `chapters.accent_color` — the seed itself — through a runtime
 * contrast check. That check existed because the API only validates an accent
 * against a *light* background, so a legal stored accent could still be
 * unreadable on the dark card surface.
 *
 * ## Step 11, not step 9
 *
 * The role this value plays is `accent-text` — "accent-colored text and icons
 * on neutral or subtle-bg surfaces" (`accent-engine.md` §2). Almost every
 * consumer treats it as a foreground: the active tab tint
 * (`app/(tabs)/_layout.tsx`), the state-block glyph, chip labels.
 *
 * `accent-primary` (step 9) is the *solid fill* role, and §8's contrast
 * guarantee deliberately does not cover it — only the text roles are gated.
 * Painting step 9 as a foreground would be worse than the raw seed it replaced:
 * on the `#1E1B17` card surface a crimson chapter's step 9 measures **1.71:1**
 * and a forest-green one **2.13:1**, against the 4.5:1 floor. Step 11 measures
 * 7.8–9.8:1 for every colour in the chapter directory seed, and reads equally
 * well as a chip fill under the fixed `gold.onHouse` label (7.3:1+).
 *
 * So the generated scale removes the problem rather than compensating for it —
 * but only via the role that was specified for this job. A surface that wants a
 * solid accent fill should read `--signet-accent-primary` directly and pair it
 * with `--signet-accent-on-primary`, which is contrast-corrected for exactly
 * that pairing.
 *
 * The legacy resolver stays as the fallback for exactly one case — a chapter
 * whose `theme_palette` predates the Signet map and has not been recomputed. It
 * outlived `derivePalette`, which the #920 slice-9 cutover deleted: the two
 * were independent all along, since this path re-validates `accent_color` and
 * never read that engine's token map. It retires when every chapter has been
 * through one save or recompute (§6).
 */
export function useChapterBranding(): ChapterBranding {
  const { data } = useCurrentChapter();
  const { tokens } = useFrappTheme();

  const surface = tokens.color.surface.card;
  const brandAccent = tokens.color.gold.house;
  const chapter = data as Record<string, unknown> | undefined;
  const accentColor = readString(chapter, "accent_color");
  const palette = chapter?.["theme_palette"] as
    | Record<string, unknown>
    | undefined;
  const generatedAccent = readString(palette, "--signet-accent-text");

  return useMemo(() => {
    if (generatedAccent) {
      return {
        accent: generatedAccent,
        accentFallbackApplied: false,
        logoUrl: readString(chapter, "logo_url"),
        chapterName: readString(chapter, "name"),
      };
    }

    const resolved = resolveChapterAccentColor(accentColor ?? undefined, {
      background: surface,
      fallbackAccent: brandAccent,
    });

    return {
      accent: resolved.resolvedAccent,
      accentFallbackApplied: resolved.fallbackApplied,
      logoUrl: readString(chapter, "logo_url"),
      chapterName: readString(chapter, "name"),
    };
  }, [accentColor, brandAccent, chapter, generatedAccent, surface]);
}
