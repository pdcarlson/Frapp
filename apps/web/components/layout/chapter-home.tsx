"use client";

import { useMemo } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { chapterMarkFor, CrestTile } from "@/components/layout/crest-tile";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * The home view (#3779): what the desktop shell shows with nothing open,
 * neither chat nor a tool. The chapter's mark, name and school on a glow of
 * its accent, which needs nothing new from the chapter.
 *
 * The mark is the nav's own (`chapterMarkFor` and `CrestTile` at its `home`
 * size), from the same current-chapter read, so the two never disagree, and
 * the accent pairs are the engine's, AA for every seed. An officer-uploaded
 * chapter photo is a later step of #3779; this is the default it will replace.
 */
export function ChapterHome() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data: chapter } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  const mark = useMemo(() => (chapter ? chapterMarkFor(chapter) : null), [
    chapter,
  ]);

  return (
    <section
      aria-label="Home"
      data-chapter-home=""
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-background px-6 text-center"
    >
      {/* The glow: the chapter accent, soft, behind the mark. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-text opacity-[0.14] blur-[120px]"
      />
      {mark && chapter ? (
        <div className="relative flex flex-col items-center gap-5">
          <CrestTile mark={mark} size="home" />
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold text-foreground">
              {chapter.name}
            </h2>
            {chapter.university ? (
              <p className="text-sm text-muted-foreground">
                {chapter.university}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
