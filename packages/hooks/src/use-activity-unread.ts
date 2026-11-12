"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Activity, ActivityItemRef } from "./activity-rows";
import { activityKeys } from "./use-activity";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** Every `kind:id` the refs name, as `markActivityItemsRead` matches them. */
function refKeys(refs: ActivityItemRef[]): Set<string> {
  return new Set(refs.map((ref) => `${ref.kind}:${ref.item_id}`));
}

/**
 * The read with these items' dots cleared, in every list that carries
 * them, or the same object when none of them was unread (so the cache
 * doesn't change and nothing re-renders). A task can sit in two lists, and
 * a poll is named by its message.
 */
export function markActivityItemsRead(
  activity: Activity,
  refs: ActivityItemRef[],
): Activity {
  const keys = refKeys(refs);
  let changed = false;
  const clear = <T extends { unread: boolean }>(
    rows: T[],
    key: (row: T) => string,
  ): T[] => {
    const hit = (row: T) => row.unread && keys.has(key(row));
    if (!rows.some(hit)) return rows;
    changed = true;
    return rows.map((row) => (hit(row) ? { ...row, unread: false } : row));
  };
  const task = (row: { id: string }) => `task:${row.id}`;
  const next: Activity = {
    ...activity,
    needs_you: {
      ...activity.needs_you,
      tasks: clear(activity.needs_you.tasks, task),
      task_confirmations: clear(activity.needs_you.task_confirmations, task),
      hours_approvals: clear(
        activity.needs_you.hours_approvals,
        (row) => `hours_entry:${row.id}`,
      ),
      polls: clear(activity.needs_you.polls, (row) => `poll:${row.message_id}`),
    },
    coming_up: clear(activity.coming_up, (row) => `event:${row.id}`),
    links: clear(activity.links, (row) => `link:${row.id}`),
  };
  return changed ? next : activity;
}

/**
 * Unread dots on Activity (`spec/behavior/activity.md` § Unread, #4402).
 *
 * Starts the member's dots: when the read serves `unread_since: null`, it
 * calls `PUT /v1/activity/unread-since` once for the chapter, so a row that
 * appears from then on is unread until opened, and nothing older ever is.
 * The call is idempotent on the server, so a read that served null only
 * because the opens couldn't be loaded starts nothing new.
 *
 * Returns `markRead`, which a screen calls with a row's `readRef` when the
 * member opens it from Activity. The dot clears at once, before the server
 * answers; a failed record leaves the dot cleared until the next read, since
 * a dot is a hint and the page re-reads often.
 */
export function useActivityUnread(activity: Activity | undefined): {
  markRead: (refs: ActivityItemRef[]) => void;
} {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  const started = useRef<string | null>(null);

  const needsStart = !!activity && activity.unread_since === null;
  useEffect(() => {
    if (!needsStart || !chapterId || started.current === chapterId) return;
    started.current = chapterId;
    void client.PUT("/v1/activity/unread-since").then(({ error }) => {
      // Try again on a later read; nothing else waits on it.
      if (error && started.current === chapterId) started.current = null;
    });
  }, [needsStart, chapterId, client]);

  const mutation = useMutation({
    mutationKey: ["activity-mark-read"],
    mutationFn: async (refs: ActivityItemRef[]) => {
      const { error } = await client.POST("/v1/activity/reads", {
        body: { items: refs },
      });
      if (error) throw error;
    },
    onMutate: async (refs: ActivityItemRef[]) => {
      if (!chapterId) return { cancelled: false };
      const queryKey = activityKeys.chapter(chapterId);
      // A read already in flight hasn't seen this open; landing after the
      // clear it would bring the dot back. It is cancelled here and read
      // again once the open is recorded, so what it was fetching for (a
      // re-read after an action) still lands.
      const cancelled = queryClient.isFetching({ queryKey, exact: true }) > 0;
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<Activity>(queryKey, (current) =>
        current ? markActivityItemsRead(current, refs) : current,
      );
      return { cancelled };
    },
    onSettled: (_data, error, refs, context) => {
      if (!chapterId) return;
      const queryKey = activityKeys.chapter(chapterId);
      if (!error) {
        queryClient.setQueryData<Activity>(queryKey, (current) =>
          current ? markActivityItemsRead(current, refs) : current,
        );
      }
      // Read again behind a read this cancelled, or one that started before
      // the server recorded the open and would still serve the dot.
      if (
        context?.cancelled ||
        queryClient.isFetching({ queryKey, exact: true }) > 0
      ) {
        void queryClient.invalidateQueries({ queryKey, exact: true });
      }
    },
  });

  return {
    markRead: (refs) => {
      if (refs.length > 0) mutation.mutate(refs);
    },
  };
}
