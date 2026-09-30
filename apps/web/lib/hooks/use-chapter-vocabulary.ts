"use client";

import { useCurrentChapter } from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { memberViewVocabulary, type VocabConfig } from "@/lib/vocabulary";

/**
 * The active chapter's vocabulary for member-facing surfaces, from the member
 * view rather than the officer-only config (#2957). The same query, and cache
 * entry, as `useChapterModuleGate`. `undefined` until the read answers, which
 * `vocab()` shows as the IFC defaults.
 */
export function useChapterVocabulary(): VocabConfig | undefined {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chapterQuery = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  return memberViewVocabulary(
    chapterQuery.data as
      | Parameters<typeof memberViewVocabulary>[0]
      | undefined,
  );
}
