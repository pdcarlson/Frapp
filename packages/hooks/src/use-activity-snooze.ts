"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Activity, ActivityItemRef } from "./activity-rows";
import { setActivitySnooze } from "./activity-snooze";
import { activityKeys } from "./use-activity";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

interface SnoozeChange {
  ref: ActivityItemRef;
  /** When it comes back; `null` brings it back now. */
  until: Date | null;
}

/**
 * Snooze and unsnooze on Activity (#4982, `spec/behavior/activity.md` §
 * Snooze). The row moves at once, before the server answers, and the read
 * is taken again after, so the tab's badge (`needs_you_count`) follows. A
 * refused write puts the row back where it was and rejects, for the screen
 * to say so.
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
    mutationKey: ["activity-snooze"],
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
      if (!chapterId) return { previous: undefined };
      const queryKey = activityKeys.chapter(chapterId);
      // A read in flight hasn't seen the change and would undo it on landing.
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<Activity>(queryKey);
      queryClient.setQueryData<Activity>(queryKey, (current) =>
        current
          ? setActivitySnooze(current, ref, until ? until.toISOString() : null)
          : current,
      );
      return { previous };
    },
    onError: (_error, _change, context) => {
      if (!chapterId || !context?.previous) return;
      queryClient.setQueryData(
        activityKeys.chapter(chapterId),
        context.previous,
      );
    },
    onSettled: () => {
      if (!chapterId) return;
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
