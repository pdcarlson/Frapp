"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { activityNextPollClose, type Activity } from "./activity-rows";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** Chapter-scoped keys; the read is `activityKeys.chapter(chapterId)`. */
export const activityKeys = createChapterQueryKeys("activity");

/**
 * The Activity page's read (`GET /v1/activity`, `spec/behavior/activity.md`):
 * what waits on the member and what they made.
 *
 * Not `useActivityFeed`, which is the chapter feed no screen renders.
 *
 * A poll row carries no tallies; draw chat's own card from the message it
 * points at. Invalidate `activityKeys.chapter(chapterId)` after acting on a row (a vote, a
 * task transition, an approval) so the row leaves "Needs you".
 */
export function useActivity(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    // `enabled` holds the query until there is a chapter, so the key is never
    // built without one.
    queryKey: activityKeys.chapter(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/activity");
      if (error) throw error;
      return data;
    },
    // Never fresh: the page gathers records other surfaces change (a vote in
    // chat, a task finished on the board, hours approved on the Service
    // page), and none of those writers knows about this read. So it is
    // re-read whenever the page mounts or the window regains focus, instead
    // of every writer being taught to invalidate it.
    staleTime: 0,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

/** The longest `setTimeout` accepts; a later close is waited for in steps. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The time the Activity page draws against: now, moved on whenever an open
 * poll on the page reaches its closing time, so the poll leaves its section
 * (and its tile's count) without a re-read (#4258). Pass it to
 * `activityGroups` and `activitySummary`.
 */
export function useActivityClock(activity: Activity | undefined): Date {
  // Bumped when a poll's time runs out; a fresh read also takes a fresh now.
  const [tick, setTick] = useState(0);
  const now = useMemo(
    () => new Date(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed on purpose: a new read or a tick is a new now
    [activity, tick],
  );
  useEffect(() => {
    if (!activity) return undefined;
    const wait = activityNextPollClose(activity, now);
    if (wait === null) return undefined;
    // A beat past the closing time, so the poll reads as closed when drawn.
    const timer = setTimeout(
      () => setTick((count) => count + 1),
      Math.min(Math.max(wait, 0) + 250, MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [activity, now]);
  return now;
}
