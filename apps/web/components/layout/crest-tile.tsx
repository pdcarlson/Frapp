"use client";

import { useState } from "react";
import type { ChapterMark } from "@repo/validation";
import { cn } from "@/lib/utils";

/**
 * The crest tile: 28px, radius 8. It draws the chapter mark (#2876), in the
 * precedence `resolveChapterMark` owns: the logo, then the short name, then
 * Greek letters unless the chapter turned them off, then initials.
 *
 * A text mark is chapter-tinted on purpose, and not a brand surface: the
 * locked emblem is the product mark and never takes a tenant accent, while
 * this tile is the *chapter's* own mark, which is exactly what the accent
 * engine is for. `accent-text` on `accent-subtle` is one of the pairs the
 * engine holds to AA for every seed (accent-engine.md §8), so no chapter
 * colour can make the letters illegible.
 *
 * A logo sits on the neutral `surface-1` step instead, never the accent fill,
 * so the chapter's artwork isn't recoloured by its own accent. It is drawn as
 * uploaded; Settings previews this exact tile so an officer sees how their
 * logo reads on the dark nav before it ships to every member. A logo that
 * fails to load (a signed URL that expired under a long session) falls back
 * to the text mark rather than a broken-image glyph.
 */
export function CrestTile({
  mark,
  fallbackText,
}: {
  mark: ChapterMark;
  /** What the tile shows if the logo fails to load. */
  fallbackText: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (mark.kind === "logo" && failedUrl !== mark.url) {
    return (
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-border bg-surface-1"
      >
        {/* A plain <img>, not next/image: the src is a signed storage URL
            that changes per request, which next/image would proxy and cache
            under a key that expires. `message-attachments.tsx` does the same. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mark.url}
          alt=""
          data-testid="chapter-mark-logo"
          className="h-full w-full object-contain"
          onError={() => setFailedUrl(mark.url)}
        />
      </span>
    );
  }
  const text = mark.kind === "text" ? mark.text : fallbackText;
  return (
    <span
      aria-hidden="true"
      data-testid="chapter-mark-text"
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-accent-border bg-accent-subtle font-bold text-accent-text",
        // A short name can run to six characters (CHAPTER_SHORT_NAME_MAX_LENGTH);
        // past four, the tile's 9.5px type overflows 28px, so it steps down.
        text.length > 4
          ? "text-[7.5px] tracking-normal"
          : "text-[9.5px] tracking-[0.06em]",
      )}
    >
      {text}
    </span>
  );
}
