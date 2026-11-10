"use client";

import { useState } from "react";
import { orgHidingGreekLettersIn } from "@repo/org-archetypes";
import { resolveChapterMark, type ChapterMark } from "@repo/validation";
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
/**
 * The chapter's mark, resolved from the logo and the `chapters.branding`
 * jsonb; a chapter that set none of it gets initials. `branding` goes to
 * `resolveChapterMark` as the contract types it, loose values in a jsonb
 * object. The resolver skips a malformed value and falls to the next step, so
 * one bad key costs the mark a step, never the row's name (#2844). An
 * organization that never displays its letters (FIJI) keeps them out of the
 * crest even when its stored switch was never turned off, as for a chapter
 * created before the profile knew to. The match reads the organization's name
 * inside the chapter's ("Phi Gamma Delta Tau Nu"). One function for the nav's
 * chapter row and the home view (#3779), so the two never disagree.
 */
export function chapterMarkFor(chapter: {
  name: string;
  logo_url?: string | null;
  branding?: Parameters<typeof resolveChapterMark>[0]["branding"];
}): ChapterMark {
  const branding = orgHidingGreekLettersIn(chapter.name)
    ? { ...chapter.branding, show_greek_letters: false }
    : chapter.branding;
  return resolveChapterMark({
    logoUrl: chapter.logo_url,
    branding,
    name: chapter.name,
  });
}

/**
 * Two sizes: `nav` is the 28px tile in the chapter row, `home` the 112px one
 * the home view centres (#3779). The same mark, fallback and step-down at both.
 */
const SIZES = {
  nav: {
    box: "h-7 w-7 rounded-[8px]",
    text: "text-[9.5px] tracking-[0.06em]",
    longText: "text-[7.5px] tracking-normal",
  },
  home: {
    box: "h-28 w-28 rounded-[28px]",
    text: "text-3xl tracking-[0.06em]",
    longText: "text-xl tracking-normal",
  },
} as const;

export function CrestTile({
  mark,
  size = "nav",
}: {
  mark: ChapterMark;
  size?: keyof typeof SIZES;
}) {
  const dims = SIZES[size];
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (mark.logoUrl && failedUrl !== mark.logoUrl) {
    const url = mark.logoUrl;
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden border border-border bg-surface-1",
          dims.box,
        )}
      >
        {/* A plain <img>, not next/image: the src is a signed storage URL
            that changes per request, which next/image would proxy and cache
            under a key that expires. `message-attachments.tsx` does the same. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          data-testid="chapter-mark-logo"
          className="h-full w-full object-contain"
          onError={() => setFailedUrl(url)}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-testid="chapter-mark-text"
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden border border-accent-border bg-accent-subtle font-bold text-accent-text",
        dims.box,
        // A short name can run to six characters (CHAPTER_SHORT_NAME_MAX_LENGTH);
        // past four, the tile's type overflows it, so it steps down.
        mark.text.length > 4 ? dims.longText : dims.text,
      )}
    >
      {mark.text}
    </span>
  );
}
