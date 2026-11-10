"use client";

import { useMemo, useState } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { orgHidingGreekLettersIn } from "@repo/org-archetypes";
import { resolveChapterMark } from "@repo/validation";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * The home view (#3779): what the desktop shell shows with nothing open,
 * neither chat nor a tool. The chapter's mark, name and school on a glow of
 * its accent, which needs nothing new from the chapter.
 *
 * Drawn from the same reads the nav's chapter row uses (`chapter-nav-header`),
 * and the accent comes from the engine tokens, so every chapter seed holds the
 * same AA pairs it does in the nav. An officer-uploaded chapter photo is a
 * later step of #3779; this is the default it will replace.
 */
export function ChapterHome() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data: chapter } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  const [failedLogo, setFailedLogo] = useState<string | null>(null);

  const mark = useMemo(() => {
    if (!chapter) return null;
    const branding = orgHidingGreekLettersIn(chapter.name)
      ? { ...chapter.branding, show_greek_letters: false }
      : chapter.branding;
    return resolveChapterMark({
      logoUrl: chapter.logo_url,
      branding,
      name: chapter.name,
    });
  }, [chapter]);

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
      {mark ? (
        <div className="relative flex flex-col items-center gap-5">
          {mark.logoUrl && failedLogo !== mark.logoUrl ? (
            <span className="grid h-28 w-28 place-items-center overflow-hidden rounded-[28px] border border-border bg-surface-1">
              {/* A signed storage URL, as in `crest-tile.tsx`. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mark.logoUrl}
                alt=""
                className="h-full w-full object-contain"
                onError={() => setFailedLogo(mark.logoUrl ?? null)}
              />
            </span>
          ) : (
            <span
              aria-hidden="true"
              data-testid="chapter-home-mark"
              className="grid h-28 w-28 place-items-center rounded-[28px] border border-accent-border bg-accent-subtle text-3xl font-bold tracking-[0.06em] text-accent-text"
            >
              {mark.text}
            </span>
          )}
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold text-foreground">
              {chapter?.name}
            </h2>
            {chapter?.university ? (
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
