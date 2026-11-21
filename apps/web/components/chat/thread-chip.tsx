"use client";

import { ChevronRight } from "lucide-react";
import {
  authorInitialsFallback,
  memberAvatarHue,
  memberAvatarTint,
  resolveAuthorLabel,
  resolveAuthorName,
  useNow,
} from "@repo/hooks";
import {
  threadCardLabel,
  threadChipLabel,
  threadPreviewParts,
} from "@repo/chat-core/threads";
import type { ThreadLastReply, ThreadSummary } from "@repo/chat-core/types";
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
 * Under that, a one-line preview of the latest reply (slice 2): that
 * replier's face, first name ("You" for the viewer's own, "Member 2f4a1c"
 * for someone who left) and words, cut
 * with an ellipsis. Only when the row hands one over: `MessageItem` passes
 * it through `threadPreviewVisible`, so a blocked replier's words never draw.
 * The preview line is capped at 24rem, so a long reply doesn't widen the
 * card, or the message under it, to the pane.
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
  preview = null,
  viewerId = null,
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
  /** The latest reply to preview, already cleared against the block list. */
  preview?: ThreadLastReply | null;
  /** Whose reply reads "You". */
  viewerId?: string | null;
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
        // wraps). Its shrink factor is 1 against the time's 10000, so its
        // share rounds to 0px while the time is still there to give way: any
        // share at all wraps a face away while the card has room. Not below
        // 1: flex hands out only that fraction of the shortfall once the time
        // is gone, and the row would overflow the card.
        <span
          className="flex h-6 min-w-0 shrink flex-wrap gap-0.5 overflow-hidden"
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
          <span
            className="h-2 w-2 rounded-full bg-primary"
            aria-hidden="true"
          />
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
      <ChevronRight
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </>
  );
  const previewSender = preview?.sender_id ?? null;
  // Named as the timeline names its author, by the rule the phone's card
  // shares: the roster's first name, "You", Frapp, or "Member 2f4a1c" for
  // someone who left.
  const parts = preview
    ? threadPreviewParts(preview, viewerId, {
        nameOf: (id) =>
          resolveAuthorName({ sender_id: id, author_name: null }, nameFor),
        fallbackLabel: (id) =>
          resolveAuthorLabel(
            { sender_id: id, author_name: null },
            nameFor,
            null,
          ),
      })
    : null;
  const previewAuthor = { sender_id: previewSender, author_name: null };
  const previewSrc = previewSender
    ? (avatarFor?.(previewSender) ?? null)
    : null;
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">{content}</span>
      {preview ? (
        <span
          data-slot="thread-preview"
          // A fixed cap, not a percentage: the row's `w-fit` extent sizes
          // to this line's one-line width, and a percentage max-width counts
          // as none there, so a long reply would widen the message and push
          // its action bar to the pane's edge.
          className="flex min-w-0 max-w-[24rem] items-center gap-1.5"
        >
          {previewSender ? (
            <Avatar className="h-5 w-5 shrink-0" aria-hidden="true">
              {previewSrc ? <AvatarImage src={previewSrc} alt="" /> : null}
              <AvatarFallback
                className="text-label"
                tint={memberAvatarTint(
                  memberAvatarHue(
                    previewSender,
                    roleColorFor?.(previewSender) ?? null,
                  ),
                )}
              >
                {parts?.fullName
                  ? initials(parts.fullName)
                  : authorInitialsFallback(previewAuthor)}
              </AvatarFallback>
            </Avatar>
          ) : null}
          {parts?.name ? (
            <span className="max-w-[40%] shrink-0 truncate font-semibold text-foreground">
              {parts.name}
            </span>
          ) : null}
          <span className="min-w-0 truncate text-muted-foreground">
            {parts?.text}
          </span>
        </span>
      ) : null}
    </>
  );
  const className = cn(
    // `self-start`: in cozy and compact the card sits in a stretching
    // column, and a bordered card as wide as a long message reads wrong.
    "mt-1.5 inline-flex min-w-0 max-w-full self-start flex-col gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-caption leading-5",
  );
  const label = threadCardLabel({ replies, fresh, lastReply, preview: parts });
  if (!onOpen) {
    return (
      <div data-slot="thread-card" className={className}>
        {body}
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
      {body}
    </button>
  );
}
