"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronDown, Loader2 } from "lucide-react";
import { useAccessibleChapters, useCurrentChapter } from "@repo/hooks";
import type { ChapterMembershipSummary } from "@repo/hooks";
import { CurrentChapterPayloadSchema } from "@repo/validation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useSelectChapter } from "@/lib/auth/select-chapter";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { cn } from "@/lib/utils";

/**
 * The 40px chapter row at the top of the left nav.
 *
 * This is the merge the board calls for: the old sidebar stacked a
 * `ChapterLockup` card (crest, name, designation, school) on top of a separate
 * `ChapterSwitcher` select, which together cost roughly 100px of nav height to
 * say one thing. Board option `1b` replaces both with a single row — crest tile,
 * chapter name, chevron — and `1t` records the two old components as deleted.
 *
 * What the merge deliberately keeps:
 *
 * - **The row always renders.** The old switcher returned `null` for the
 *   single-chapter case that describes nearly every user. Here the row *is* the
 *   chapter's identity, so it renders regardless; only the menu's contents
 *   change. A member with one chapter still gets "Join another chapter" and
 *   chapter settings.
 * - **Switching still goes through `useSelectChapter`**, never the chapter
 *   store directly. The `active_chapter_id` JWT claim outranks the
 *   `x-chapter-id` header, so writing the store alone puts the two in
 *   disagreement and earns a 403 on every later request (spec/behavior/
 *   multi-tenancy.md).
 * - **The recovery case.** A persisted chapter that is gone (membership
 *   revoked, or a stale id from another account in this browser) leaves the
 *   member with no way out, so it still gets its own affordance.
 *
 * Identity and chapter stay separate menus: the account menu hangs off the
 * top-bar avatar and carries Profile and Sign out, and chapter switching is
 * only here (`1i`: "Identity and chapter stay separate menus").
 */

type ChapterNavHeaderProps = {
  collapsed: boolean;
  className?: string;
  onNavigate?: () => void;
};

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "--";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/**
 * The crest tile: 28px, radius 8, accent-subtle fill with accent text.
 *
 * Chapter-tinted on purpose, and not a brand surface. The locked emblem is the
 * product mark and never takes a tenant accent; this tile is the *chapter's*
 * own letters, which is exactly what the accent engine is for.
 */
function CrestTile({ crest }: { crest: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border border-accent-border bg-accent-subtle text-[9.5px] font-bold tracking-[0.06em] text-accent-text"
    >
      {crest}
    </span>
  );
}

export function ChapterNavHeader({
  collapsed,
  className,
  onNavigate,
}: ChapterNavHeaderProps) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data: chapterData, isError: chapterFailed } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  const { data: membershipData, isSuccess } = useAccessibleChapters();
  const selectChapter = useSelectChapter();
  const { toast } = useToast();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const memberships = useMemo(() => {
    const rows: ChapterMembershipSummary[] = Array.isArray(membershipData)
      ? membershipData
      : [];
    return [...rows].sort((a, b) =>
      (a.chapter?.name ?? "").localeCompare(b.chapter?.name ?? ""),
    );
  }, [membershipData]);

  const activeMembership = memberships.find(
    (m) => m.chapter_id === activeChapterId,
  );

  // Crest and name come from the chapter record's branding when it is
  // populated, and fall back to initials of the name otherwise — the branding
  // fields live on `chapters.branding` jsonb and predate many chapters.
  const identity = useMemo(() => {
    if (!chapterData) return null;
    const parsed = CurrentChapterPayloadSchema.safeParse(chapterData);
    if (!parsed.success) return null;
    const payload = parsed.data;
    return {
      crest:
        payload.branding?.greek_letters?.trim() || initialsFor(payload.name),
      name: payload.name,
    };
  }, [chapterData]);

  async function handleSelect(chapterId: string) {
    if (switchingTo || chapterId === activeChapterId) return;
    setSwitchingTo(chapterId);
    try {
      const switched = await selectChapter(chapterId);
      if (!switched) {
        toast({
          variant: "destructive",
          title: "Couldn't switch chapter",
          description:
            "You're still in your previous chapter. Check your connection and try again.",
        });
        setSwitchingTo(null);
        return;
      }
      // Full reload into the dashboard root rather than an in-place re-render.
      //
      // Dropping the query cache handles cached *server* data, but a chapter id
      // is threaded through client state the cache knows nothing about: the
      // chat shell holds the selected channel id (which 404s under the new
      // chapter), and the realtime manager holds live Supabase subscriptions
      // keyed to the old chapter's channels. Enumerating that state is the same
      // losing game as enumerating query keys, and a chapter switch is a rare,
      // deliberate, whole-context action — so start from a clean slate.
      //
      // `switchingTo` is intentionally left set: the spinner stays up until the
      // document is replaced, instead of flashing back to the old chapter.
      window.location.assign("/");
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't switch chapter",
        description: "Something went wrong. Please try again.",
      });
      setSwitchingTo(null);
    }
  }

  // Mid-switch the query cache is dropped, so `memberships` is briefly empty.
  // Hold the control on screen rather than letting it vanish under the pointer
  // that just clicked it.
  if (switchingTo) {
    return (
      <div
        className={cn(
          "flex h-10 items-center gap-2.5 rounded-[10px] px-1.5 text-[11px] text-muted-foreground",
          collapsed && "justify-center px-0",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        {collapsed ? null : <span role="status">Switching chapter...</span>}
      </div>
    );
  }

  // Recovery: the persisted chapter is gone and the member is stuck with an
  // `x-chapter-id` the API will reject. This is the one case that matters even
  // for a single-chapter user, so it outranks the compact row.
  if (isSuccess && memberships.length > 0 && !activeMembership) {
    return (
      <div
        className={cn(
          "space-y-2 rounded-[10px] border border-destructive/45 bg-destructive/[.13] px-2.5 py-2",
          className,
        )}
      >
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {activeChapterId ? "Chapter unavailable" : "No chapter selected"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {activeChapterId
            ? "You no longer have access to the chapter you were in. Pick one to continue:"
            : "Pick a chapter to continue:"}
        </p>
        <ul className="space-y-1">
          {memberships.map((membership) => (
            <li key={membership.chapter_id}>
              <button
                type="button"
                onClick={() => handleSelect(membership.chapter_id)}
                /*
                 * `hover:bg-popover`, not `hover:bg-card`. A row seated on
                 * `--surface-1` moving to `--card` measures 1.0486:1 on the
                 * greenfield ladder, under the 1.1 the contrast fixture treats
                 * as "reads as the same colour". Skipping to the next step up
                 * is a hover a person can actually see, and it does not require
                 * re-pitching a ladder value to fix one call site.
                 */
                className="w-full truncate rounded-xs border border-border bg-surface-1 px-2 py-1.5 text-left text-[11px] text-foreground hover:bg-popover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
              >
                {membership.chapter?.name ?? "Untitled chapter"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const crest = identity?.crest ?? (chapterFailed ? "!" : "--");
  const name =
    identity?.name ?? (chapterFailed ? "Chapter unavailable" : "Loading...");
  const otherChapters = memberships.filter(
    (m) => m.chapter_id !== activeChapterId,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Chapter menu (currently ${name})`}
          title={collapsed ? name : undefined}
          className={cn(
            "flex h-10 w-full items-center gap-2.5 rounded-[10px] px-1.5 text-left transition hover:bg-card",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
            collapsed && "justify-center px-0",
            className,
          )}
        >
          <CrestTile crest={crest} />
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                {name}
              </span>
              <ChevronDown
                className="h-3.5 w-3.5 shrink-0 text-muted"
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {otherChapters.length > 0 ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Your chapters
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {memberships.map((membership) => {
              const isActive = membership.chapter_id === activeChapterId;
              return (
                <DropdownMenuItem
                  key={membership.chapter_id}
                  onSelect={() => handleSelect(membership.chapter_id)}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      !isActive && "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">
                      {membership.chapter?.name ?? "Untitled chapter"}
                    </span>
                    {membership.chapter?.university ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {membership.chapter.university}
                      </span>
                    ) : null}
                  </span>
                  {isActive ? <span className="sr-only">(current)</span> : null}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/join" onClick={onNavigate}>
            Join another chapter
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" onClick={onNavigate}>
            Chapter settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
