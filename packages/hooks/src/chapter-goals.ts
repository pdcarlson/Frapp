"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import type { GoalMetric } from "@repo/validation";
import { activityStandingKeys } from "./activity-standing";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export type ChapterGoals = components["schemas"]["ChapterGoalsDto"];
export type GoalSet = components["schemas"]["GoalSetDto"];

/** Chapter-scoped keys; the read is `chapterGoalKeys.chapter(chapterId)`. */
export const chapterGoalKeys = createChapterQueryKeys("chapter-goals");

/**
 * The chapter's goals for points, service hours and study hours (#1062),
 * for the officer setting them (`GET /v1/goals`, `chapter-config:view`).
 * A member never reads this: their own goal rides on the standing.
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

/**
 * Replace one measure's goals (`PUT /v1/goals/{metric}`). On success the
 * stored set replaces the cached one, and the viewer's own standing is read
 * again, since their bar may have changed with it.
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
    },
  });
}
