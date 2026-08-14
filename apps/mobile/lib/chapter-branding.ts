import { useMemo } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { resolveChapterAccentColor } from "@repo/theme/accent";
import { useFrappTheme } from "./theme";

export type ChapterBranding = {
  /**
   * The accent to paint chapter-scoped UI with — the chapter's own colour when
   * it is legible on the current mode's surface, the mode's brand token when
   * it is not. Never null, so call sites need no fallback of their own.
   */
  accent: string;
  /** True when the chapter's accent failed AA and the brand token stood in. */
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
 * The accent is re-validated against the *resolved* colour mode's card
 * surface. The API only gates accents against a light background
 * (`chapter.service.ts` `LIGHT_MODE_BACKGROUND`), so a stored accent can be
 * perfectly legal and still be unreadable in dark mode; checking here is what
 * keeps the dark surface accessible.
 */
export function useChapterBranding(): ChapterBranding {
  const { data } = useCurrentChapter();
  const { tokens } = useFrappTheme();

  const surface = tokens.color.surface.card;
  const brandAccent = tokens.color.brand.bronze;
  const chapter = data as Record<string, unknown> | undefined;
  const accentColor = readString(chapter, "accent_color");

  return useMemo(() => {
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
  }, [accentColor, brandAccent, chapter, surface]);
}
