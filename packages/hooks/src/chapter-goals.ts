"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import type { GoalMetric } from "@repo/validation";
import { activityStandingKeys } from "./activity-standing";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export type ChapterGoals = components["schemas"]["ChapterGoalsDto"];
export type GoalSet = components["schemas"]["GoalSetDto"];
export type MyGoals = components["schemas"]["MyGoalsDto"];

/** Chapter-scoped keys; the read is `chapterGoalKeys.chapter(chapterId)`. */
export const chapterGoalKeys = createChapterQueryKeys("chapter-goals");

/**
 * The chapter's goals for points, service hours and study hours (#1062),
 * for the officer setting them (`GET /v1/goals`, `chapter-config:view`).
 * A member reads only their own: on the standing, or `useMyGoals`.
 */
export function useChapterGoals(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: chapterGoalKeys.chapter(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/goals");
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

/** Keys for the caller's own goals; the read is `myGoalKeys.chapter(chapterId)`. */
export const myGoalKeys = createChapterQueryKeys("my-goals");

/**
 * The caller's own goal on each measure (`GET /v1/goals/mine`), for a screen
 * that draws only the goal, such as the phone's Study screen and More row,
 * without reading the whole standing. Goals change rarely, so it stays fresh
 * for five minutes; saving goals reads it again.
 */
export function useMyGoals(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: myGoalKeys.chapter(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/goals/mine");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

/**
 * Replace one measure's goals (`PUT /v1/goals/{metric}`). On success the
 * stored set replaces the cached one, and the viewer's own standing and
 * goals are read again, since their bar may have changed with it.
 */
export function useSetChapterGoals(metric: GoalMetric) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["chapter-goals", chapterId, metric],
    mutationFn: async (goals: GoalSet) => {
      const { data, error } = await client.PUT("/v1/goals/{metric}", {
        params: { path: { metric } },
        body: goals,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      if (!chapterId) return;
      queryClient.setQueryData<ChapterGoals>(
        chapterGoalKeys.chapter(chapterId),
        (old) => (old ? { ...old, [metric]: saved } : old),
      );
      void queryClient.invalidateQueries({
        queryKey: activityStandingKeys.chapter(chapterId),
        exact: true,
      });
      void queryClient.invalidateQueries({
        queryKey: myGoalKeys.chapter(chapterId),
        exact: true,
      });
    },
  });
}
