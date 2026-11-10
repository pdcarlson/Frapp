"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export const activityQueryKey = (chapterId: string | null | undefined) =>
  ["activity", chapterId] as const;

/**
 * The Activity page's read (`GET /v1/activity`, `spec/behavior/activity.md`):
 * what waits on the member and what they made.
 *
 * Not `useActivityFeed`, which is the chapter feed no screen renders.
 *
 * A poll row carries no tallies; draw chat's own card from the message it
 * points at. Invalidate `activityQueryKey` after acting on a row (a vote, a
 * task transition, an approval) so the row leaves "Needs you".
 */
export function useActivity(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: activityQueryKey(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/activity");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}
