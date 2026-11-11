"use client";

import { ChevronRight } from "lucide-react";
import { memberAvatarHue, memberAvatarTint, useNow } from "@repo/hooks";
import { threadChipLabel } from "@repo/chat-core/threads";
import type { ThreadSummary } from "@repo/chat-core/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn, initials } from "@/lib/utils";

/**
 * The thread card under a message that has thread replies (#3785, rebuilt as
 * a card in #4297 after Discord's): the repliers' faces side by side, "N
 * replies" in the accent, how many are new to the viewer, and when the last
 * one came, in a bordered card that opens the thread. In cozy a connector
 * line runs to it from the author's photo (`MessageItem`'s `thread-spine`).
 *
 * The faces sit apart rather than overlapping: at this size an overlap hid
 * half of each replier's initials (Shawn, 2026-11-11). On a narrow card
 * "last reply" drops out whole first, then the faces; the count, "2 new"
 * and the chevron always show.
 *
 * On an Important row the count draws in the foreground, as every
 * chapter-accent text on that row does (`IMPORTANT_ROW`), matching mobile.
 */
export function ThreadChip({
  summary,
  nameFor,
  avatarFor,
  roleColorFor,
  unread = 0,
  onOpen,
}: {
  summary: ThreadSummary;
  nameFor: (userId: string) => string | null;
  /** A replier's photo, when they have one; initials otherwise. */
  avatarFor?: (userId: string) => string | null;
  /** A replier's top role color, which picks their initials' tint (#3860). */
  roleColorFor?: (userId: string) => string | null;
  /** Replies new to the viewer, from the threads they follow. */
  unread?: number;
  onOpen?: () => void;
}) {
  // The app's one shared clock, so every card ticks together.
  const now = useNow();
  const { replies, lastReply } = threadChipLabel(
    summary.reply_count,
    summary.last_reply_at,
    now,
  );
  const fresh = unread > 0 ? `${unread} new` : null;
  const content = (
    <>
      {summary.recent_sender_ids.length > 0 ? (
        // On a narrow card the faces go after the time, before the count,
        // one at a time from the right: each is its own item in a clipped
        // wrapping box, behind a zero-width lead (a line's first item never
        // wraps). Its shrink factor is a sliver of the time's, so the time
        // takes the whole shortfall until it is gone: any share here, even a
        // pixel, wraps a face away while the card still has room.
        <span
          className="flex h-6 min-w-0 shrink-[0.0001] flex-wrap gap-0.5 overflow-hidden"
          aria-hidden="true"
        >
          <span className="-mr-0.5 h-6 w-0" />
          {summary.recent_sender_ids.map((id) => {
            const src = avatarFor?.(id) ?? null;
            return (
              <Avatar key={id} className="h-6 w-6 shrink-0">
                {src ? <AvatarImage src={src} alt="" /> : null}
                <AvatarFallback
                  className="text-label"
                  tint={memberAvatarTint(
                    memberAvatarHue(id, roleColorFor?.(id) ?? null),
                  )}
                >
                  {initials(nameFor(id) ?? "?")}
                </AvatarFallback>
              </Avatar>
            );
          })}
        </span>
      ) : null}
      <span className="shrink-0 font-semibold text-primary">{replies}</span>
      {fresh ? (
        <span
          data-slot="thread-unread"
          className="flex shrink-0 items-center gap-1 font-semibold text-foreground"
        >
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
          {fresh}
        </span>
      ) : null}
      {lastReply ? (
        // All or nothing: where it doesn't fit it wraps to a clipped second
        // line rather than shrinking to "l…". A line's first item never
        // wraps, so a zero-width one leads. It gives way first of all.
        <span className="flex h-5 min-w-0 shrink-[10000] flex-wrap overflow-hidden">
          <span className="h-5 w-0" />
          <span className="shrink-0 whitespace-nowrap text-muted-foreground">
            {lastReply}
          </span>
        </span>
      ) : null}
      {/* At the card's right edge, so room the time gave up sits before it. */}
      <ChevronRight
        className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </>
  );
  const className = cn(
    // `self-start`: in cozy and compact the card sits in a stretching
    // column, and a bordered card as wide as a long message reads wrong.
    "mt-1.5 inline-flex min-w-0 max-w-full self-start items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-caption leading-5",
  );
  const label = [replies, fresh, lastReply].filter(Boolean).join(", ");
  if (!onOpen) {
    return (
      <div data-slot="thread-card" className={className}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-slot="thread-card"
      className={cn(className, "text-left hover:bg-surface-1", FOCUS_RING)}
      aria-label={`${label}. Open thread`}
      onClick={onOpen}
    >
      {content}
    </button>
  );
}
