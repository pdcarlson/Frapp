"use client";

import { CurrentChapterPayloadSchema } from "@repo/validation";
import { useCurrentChapter } from "@repo/hooks";
import { cn } from "@/lib/utils";
import { useChapterStore } from "@/lib/stores/chapter-store";

type ChapterLockupProps = {
  className?: string;
};

type LockupView = {
  crest: string;
  name: string;
  designation: string | null;
  schoolShort: string | null;
};

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "—";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function shortenSchool(university: string): string {
  const trimmed = university.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  if (parts.length <= 2) return trimmed;
  return parts
    .filter((p) => p[0]?.match(/[A-Z]/))
    .map((p) => p[0])
    .join("")
    .slice(0, 4);
}

/*
 * Chapter lockup — the redesign's sidebar header. Renders a small crest
 * tile of Greek letters next to chapter name + designation + school
 * short. Falls back gracefully when the chapter record predates the
 * branding fields landing in Chunk 2 (greek_letters / designation /
 * school_short live on `chapters.branding` jsonb, not yet populated).
 */
export function ChapterLockup({ className }: ChapterLockupProps) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data, isPending, isError } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });

  let view: LockupView | null = null;
  let loadFailed = false;
  if (activeChapterId) {
    if (isError) {
      loadFailed = true;
    } else if (data) {
      const parsed = CurrentChapterPayloadSchema.safeParse(data);
      if (parsed.success) {
        const payload = parsed.data;
        view = {
          crest: initialsFor(payload.name),
          name: payload.name,
          designation: null,
          schoolShort: shortenSchool(payload.university),
        };
      } else {
        loadFailed = true;
      }
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-side-divider bg-side-bg-hi px-3 py-2.5",
        className,
      )}
    >
      <div
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xs border border-side-divider bg-side-bg text-[11px] font-bold uppercase tracking-wider text-side-accent"
      >
        {view?.crest ?? (isPending ? "··" : loadFailed ? "!" : "—")}
      </div>
      <div className="min-w-0 flex-1">
        {view ? (
          <>
            <p className="truncate text-[13px] font-semibold text-side-fg-hi">
              {view.name}
            </p>
            {view.designation || view.schoolShort ? (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-side-muted">
                {view.designation ? <span>{view.designation}</span> : null}
                {view.designation && view.schoolShort ? (
                  <span aria-hidden className="text-side-muted/60">
                    •
                  </span>
                ) : null}
                {view.schoolShort ? <span>{view.schoolShort}</span> : null}
              </p>
            ) : null}
          </>
        ) : isPending ? (
          <>
            <span className="block h-3 w-2/3 animate-pulse rounded-xs bg-side-bg" />
            <span className="mt-1.5 block h-2 w-1/2 animate-pulse rounded-xs bg-side-bg" />
          </>
        ) : loadFailed ? (
          <>
            <p className="text-[13px] font-semibold text-side-fg-hi">
              Chapter unavailable
            </p>
            <p className="mt-0.5 text-[11px] text-side-muted">
              Couldn’t load chapter details
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-semibold text-side-fg-hi">
              No chapter
            </p>
            <p className="mt-0.5 text-[11px] text-side-muted">
              Select a chapter to begin
            </p>
          </>
        )}
      </div>
    </div>
  );
}
