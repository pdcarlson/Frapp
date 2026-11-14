"use client";

import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Activity, ActivityItemRef } from "./activity-rows";
import { activityNextWake, setActivitySnooze } from "./activity-snooze";
import { activityKeys } from "./use-activity";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

const SNOOZE_MUTATION_KEY = ["activity-snooze"] as const;

interface SnoozeChange {
  ref: ActivityItemRef;
  /** When it comes back; `null` brings it back now. */
  until: Date | null;
}

/** The item's `snoozed_until` in the read, wherever it is listed. */
function snoozedUntilOf(
  activity: Activity | undefined,
  ref: ActivityItemRef,
): string | null {
  if (!activity) return null;
  const { needs_you } = activity;
  const found =
    ref.kind === "task"
      ? [...needs_you.tasks, ...needs_you.task_confirmations].find(
          (row) => row.id === ref.item_id,
        )
      : ref.kind === "hours_entry"
        ? needs_you.hours_approvals.find((row) => row.id === ref.item_id)
        : ref.kind === "poll"
          ? needs_you.polls.find((row) => row.message_id === ref.item_id)
          : ref.kind === "event"
            ? activity.coming_up.find((row) => row.id === ref.item_id)
            : ref.kind === "link"
              ? activity.links.find((row) => row.id === ref.item_id)
              : (needs_you.cards ?? []).find(
                  (row) => row.message_id === ref.item_id,
                );
  return found?.snoozed_until ?? null;
}

/**
 * Snooze and unsnooze on Activity (#4982, `spec/behavior/activity.md` §
 * Snooze). The row moves at once, before the server answers, and the read
 * is taken again once no other snooze is in flight, so the tab's badge
 * (`needs_you_count`) follows. A refused write puts back only that item's
 * snooze, leaving any change made meanwhile, and rejects, for the screen to
 * say so.
 */
export function useActivitySnooze(): {
  snooze: (ref: ActivityItemRef, until: Date) => Promise<void>;
  unsnooze: (ref: ActivityItemRef) => Promise<void>;
  isPending: boolean;
} {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  const mutation = useMutation({
    mutationKey: SNOOZE_MUTATION_KEY,
    mutationFn: async ({ ref, until }: SnoozeChange) => {
      const { error } = until
        ? await client.PUT("/v1/activity/snoozes", {
            body: { ...ref, until: until.toISOString() },
          })
        : await client.DELETE("/v1/activity/snoozes", {
            params: { query: ref },
          });
      if (error) throw error;
    },
    onMutate: async ({ ref, until }: SnoozeChange) => {
      if (!chapterId) return { before: null };
      const queryKey = activityKeys.chapter(chapterId);
      // A read in flight hasn't seen the change and would undo it on landing.
      await queryClient.cancelQueries({ queryKey, exact: true });
      const before = snoozedUntilOf(
        queryClient.getQueryData<Activity>(queryKey),
        ref,
      );
      queryClient.setQueryData<Activity>(queryKey, (current) =>
        current
          ? setActivitySnooze(current, ref, until ? until.toISOString() : null)
          : current,
      );
      return { before };
    },
    onError: (_error, { ref }, context) => {
      if (!chapterId || !context) return;
      queryClient.setQueryData<Activity>(
        activityKeys.chapter(chapterId),
        (current) =>
          current ? setActivitySnooze(current, ref, context.before) : current,
      );
    },
    onSettled: () => {
      if (!chapterId) return;
      // The last one in flight reads again: an earlier one's read would land
      // without the later change and undo it until that one settles.
      if (queryClient.isMutating({ mutationKey: SNOOZE_MUTATION_KEY }) > 1) {
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: activityKeys.chapter(chapterId),
        exact: true,
      });
    },
  });

  return {
    snooze: (ref, until) => mutation.mutateAsync({ ref, until }),
    unsnooze: (ref) => mutation.mutateAsync({ ref, until: null }),
    isPending: mutation.isPending,
  };
}

/**
 * Reads Activity again when the soonest snooze in `activity` ends (#4982).
 * The screen's clock brings the row back on its tick (`activityAwake`); this
 * read is what brings its unread dot and its place in the badge, which only
 * the server can work out. Call it once per screen that lists Activity.
 */
export function useActivitySnoozeWake(activity: Activity | undefined): void {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  const wake = activity ? activityNextWake(activity, new Date()) : null;
  const at = wake?.getTime() ?? null;
  useEffect(() => {
    if (at === null || !chapterId) return undefined;
    // A second past the end, so the server sees it as ended. A timer
    // capped at a day: browsers fire one set further out at once.
    const delay = Math.min(Math.max(at - Date.now() + 1000, 0), 86_400_000);
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({
        queryKey: activityKeys.chapter(chapterId),
        exact: true,
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [at, chapterId, queryClient]);
}
