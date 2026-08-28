"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useAccessibleChapters } from "@repo/hooks";
import type { ChapterMembershipSummary } from "@repo/hooks";
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

type ChapterSwitcherProps = {
  className?: string;
};

/**
 * Chapter switcher — the dashboard shell's control for users who belong to more
 * than one chapter (advisors, transfers, officers in two chapters).
 *
 * Deliberately additive to `ChapterLockup`, which keeps rendering the active
 * chapter's identity. This component renders *nothing* for the single-chapter
 * case that describes nearly every user, so the common sidebar is unchanged.
 *
 * Switching always goes through `useSelectChapter`, never through
 * `chapter-store` directly: the `active_chapter_id` JWT claim outranks the
 * `x-chapter-id` header, so writing the store alone would put the two in
 * disagreement and earn a 403 (`chapter.context.mismatch`) on every subsequent
 * request until the token expired. See spec/behavior/multi-tenancy.md.
 */
export function ChapterSwitcher({ className }: ChapterSwitcherProps) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data, isSuccess } = useAccessibleChapters();
  const selectChapter = useSelectChapter();
  const { toast } = useToast();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const memberships = useMemo(() => {
    const rows: ChapterMembershipSummary[] = Array.isArray(data) ? data : [];
    return [...rows].sort((a, b) =>
      (a.chapter?.name ?? "").localeCompare(b.chapter?.name ?? ""),
    );
  }, [data]);

  const activeMembership = memberships.find(
    (m) => m.chapter_id === activeChapterId,
  );

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
      // Dropping the query cache (FrappProvider) handles cached *server* data,
      // but a chapter id is threaded through client state the cache knows
      // nothing about: the chat shell holds the selected channel id (which
      // 404s under the new chapter), and the realtime manager holds live
      // Supabase subscriptions keyed to the old chapter's channels. Both were
      // observed breaking an in-place switch. Enumerating that state is the
      // same losing game as enumerating query keys, and a chapter switch is a
      // rare, deliberate, whole-context action — so start from a clean slate.
      //
      // The root is the destination because the current route may itself be
      // chapter-scoped (`/events/<id>` from the outgoing chapter).
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
  // Hold the control on screen rather than letting it disappear under the
  // pointer that just clicked it.
  if (switchingTo) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        <span role="status">Switching chapter…</span>
      </div>
    );
  }

  // Loading and error states belong to `ChapterLockup`, which sits directly
  // above this in the sidebar and already renders both. Adding a second
  // spinner/error here would just duplicate them.
  if (!isSuccess || memberships.length === 0) {
    return null;
  }

  // Recovery (AC #4): the persisted chapter is gone — membership revoked, or a
  // stale id in localStorage from another account on this browser. The user is
  // stuck with an `x-chapter-id` the API will reject, and no way out, so offer
  // the chapters they *can* reach. This is the one case that matters even for
  // single-chapter users.
  if (!activeMembership) {
    return (
      <div
        className={cn(
          "space-y-2 rounded-lg border border-destructive/45 bg-destructive/[.13] px-3 py-2.5",
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
                className="w-full truncate rounded-xs border border-border bg-surface-1 px-2 py-1.5 text-left text-[11px] text-foreground hover:bg-card focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
              >
                {membership.chapter?.name ?? "Untitled chapter"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Nothing to switch between.
  if (memberships.length < 2) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch chapter (currently ${activeMembership.chapter?.name ?? "unknown"})`}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-popover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">Switch chapter</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
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
                className={cn("h-3.5 w-3.5 shrink-0", !isActive && "opacity-0")}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
