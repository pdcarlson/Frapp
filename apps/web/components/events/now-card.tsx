"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatClockShort } from "@repo/formatting";
import { eventNowPill, eventNowState, useEventsOnNow } from "@repo/hooks";
import { EVENT_NOW_COPY } from "@repo/validation";
import { cn } from "@/lib/utils";

/**
 * The Now card (`spec/behavior/activity.md` § Now, #5777): the event on right
 * now, at the top of the chat rail and of Activity, as the phone draws it on
 * Chat home and Activity.
 *
 * Paul sat in a meeting on 2026-11-19 and no screen said it was on. Now is
 * the one answer to "what's on right now": "Now · until 10:25 PM", the name,
 * the member's own state and where, opening the event's sheet. With nothing
 * on it renders nothing. Like Discord's live voice channel at the top of the
 * sidebar and Teams' bar over a meeting's chat.
 */
export function NowCard({ className }: { className?: string }) {
  const { events } = useEventsOnNow();
  const lead = events[0];
  if (!lead) return null;
  const more = events.length - 1;
  const until = EVENT_NOW_COPY.until(formatClockShort(lead.end_time));
  const meta = [eventNowState(lead), lead.location].filter(Boolean).join(" · ");

  return (
    <section aria-label="On now" className={cn("grid gap-1", className)}>
      <Link
        href={`/events?event=${lead.id}`}
        className="group flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2.5 outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-2 text-caption font-semibold text-success">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-success motion-safe:animate-pulse"
            />
            <span className="truncate">{until}</span>
          </span>
          <span className="truncate text-sm font-semibold text-foreground">
            {lead.name}
          </span>
          {meta ? (
            <span className="truncate text-caption text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </span>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Link>
      {more > 0 ? (
        <p className="px-3 text-caption text-muted-foreground">
          {EVENT_NOW_COPY.more(more)}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The event's pill in its sheet (#5777), the same words as the phone's event
 * page (`eventNowPill` in `@repo/hooks`).
 */
export function EventNowPill({
  event,
  now,
}: {
  event: Parameters<typeof eventNowPill>[0];
  now: number;
}) {
  const pill = eventNowPill(event, new Date(now));
  if (!pill) return null;
  return (
    <span
      data-testid="event-now-pill"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption",
        pill.live
          ? "border-success/60 font-semibold text-success"
          : "border-border text-muted-foreground",
      )}
    >
      {pill.live ? (
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
      ) : null}
      {pill.label}
    </span>
  );
}
