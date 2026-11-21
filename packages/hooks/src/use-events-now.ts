"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { dayDelta, formatClockShort } from "@repo/formatting";
import {
  CHECK_IN_OPEN_LABEL,
  EVENT_NOW_COPY,
  eventOnAt,
} from "@repo/validation";
import { activityKeys } from "./use-activity";
import { useNow } from "./use-now";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** One row of `GET /v1/activity/now`: the shape of Activity's `coming_up`. */
export type EventNow = components["schemas"]["ActivityEventDto"];

/**
 * The key for `GET /v1/activity/now`, under Activity's chapter key so a
 * chapter switch or sign-out clears it with the rest. A check-in re-reads it
 * (`useCheckIn`); otherwise it is polled.
 */
export const eventsNowKey = (chapterId: string) =>
  [...activityKeys.chapter(chapterId), "now"] as const;

/**
 * A meeting doesn't wait for a reload: an event that opens while a screen is
 * up shows within this, and one that ends leaves at the next clock tick
 * ({@link eventsOnNow}).
 */
const EVENTS_NOW_POLL_MS = 60_000;

/**
 * The events on right now for the member (`spec/behavior/activity.md` § Now,
 * #5777), for the Now card at the top of Chat, Activity and the event. Its
 * own small read, so Chat, which shows only this, doesn't read the whole of
 * Activity.
 */
export function useEventsNow(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: eventsNowKey(chapterId!),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/activity/now", {
        signal,
      });
      if (error) throw error;
      return data.events;
    },
    refetchInterval: EVENTS_NOW_POLL_MS,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

/**
 * The rows still on at `now`. The server answered for the moment it was
 * asked; between reads an event can end, and it leaves the card then rather
 * than at the next read.
 */
export function eventsOnNow(
  rows: readonly EventNow[] | undefined,
  now: number,
): EventNow[] {
  return (rows ?? []).filter((row) =>
    eventOnAt(row.start_time, row.end_time, row.check_in_opens_minutes, now),
  );
}

/** {@link useEventsNow} narrowed by the shared clock: what the card draws. */
export function useEventsOnNow(options: { enabled?: boolean } = {}): {
  events: EventNow[];
  now: number;
} {
  const query = useEventsNow(options);
  const now = useNow();
  const events = useMemo(() => eventsOnNow(query.data, now), [query.data, now]);
  return { events, now };
}

type Activity = components["schemas"]["ActivityDto"];

/**
 * Activity's read without the events the Now card shows (#5777), so To do
 * and the phone's Frapp card don't list the live one a second time. The week ring counts from the whole read, so it still counts it.
 */
export function withoutEvents(
  activity: Activity,
  ids: readonly string[],
): Activity {
  if (ids.length === 0) return activity;
  const gone = new Set(ids);
  return {
    ...activity,
    coming_up: activity.coming_up.filter((event) => !gone.has(event.id)),
  };
}

/**
 * The ids of what the Now card shows by itself: its lead (#5777). Activity
 * leaves these out of To do and the Frapp card, and nothing
 * more: an event under "+N more on now" keeps its row and its Check in.
 */
export function nowCardEventIds(events: readonly EventNow[]): string[] {
  return events.slice(0, 1).map((event) => event.id);
}

/**
 * The member's own state on an event that is on, for the Now card on both
 * apps: checked in and when ("Checked in 9:24 PM"), or that check-in is
 * open to them. Nothing for an event check-in would refuse them (an alumnus
 * the default alone invites).
 */
export function eventNowState(event: EventNow): string | null {
  if (event.checked_in === true) {
    return EVENT_NOW_COPY.checkedIn(
      event.checked_in_at ? formatClockShort(event.checked_in_at) : null,
    );
  }
  if (event.check_in_open) return CHECK_IN_OPEN_LABEL;
  return null;
}

/**
 * The event's own pill on its page or sheet, both apps (#5777): "Now · until
 * 10:25 PM" while it is on, "Ended 10:25 PM" for the rest of the day it
 * ended, else `null`. The header's "Tonight · 9:25 – 10:25 PM" says when it
 * was planned; this says where it stands.
 */
export function eventNowPill(
  event: {
    start_time?: unknown;
    end_time?: unknown;
    check_in_opens_minutes?: unknown;
  },
  now: Date,
): { live: boolean; label: string } | null {
  const at = now.getTime();
  if (
    eventOnAt(
      event.start_time,
      event.end_time,
      event.check_in_opens_minutes,
      at,
    )
  ) {
    return {
      live: true,
      label: EVENT_NOW_COPY.until(formatClockShort(event.end_time as string)),
    };
  }
  if (typeof event.end_time !== "string") return null;
  const end = new Date(event.end_time);
  if (Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= at && dayDelta(now, end) === 0) {
    return { live: false, label: EVENT_NOW_COPY.ended(formatClockShort(end)) };
  }
  return null;
}
