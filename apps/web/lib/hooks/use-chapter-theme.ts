"use client";

import { useEffect } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import type { ChapterPalette } from "@repo/chapter-theme";

/**
 * Reads the chapter's derived theme_palette from the active chapter record
 * and writes the CSS custom properties onto :root so every component in the
 * chapter shell picks up the branding without a re-render.
 *
 * Falls back gracefully when theme_palette is empty (chapters that have not
 * yet had their palette computed via POST /chapters/:id/theme-palette).
 */
export function useChapterTheme() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data } = useCurrentChapter({ chapterId: activeChapterId });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    const raw = (data as Record<string, unknown> | undefined);
    const palette = raw?.["theme_palette"] as Partial<ChapterPalette> | undefined;

    if (!palette || Object.keys(palette).length === 0) return;

    const tokenEntries = Object.entries(palette) as [string, string][];
    for (const [token, value] of tokenEntries) {
      root.style.setProperty(token, value);
    }

    return () => {
      // Remove chapter-specific overrides when the chapter changes or unmounts
      for (const [token] of tokenEntries) {
        root.style.removeProperty(token);
      }
    };
  }, [data, activeChapterId]);
}
