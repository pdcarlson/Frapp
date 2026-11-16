"use client";

import { useQuery } from "@tanstack/react-query";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export const activityArchiveKeys = createChapterQueryKeys("activity-archive");

/**
 * The Activity Archive (`GET /v1/activity/archive`, #5127): what the member
 * has finished. Read only while the Archive is open (`enabled`), never with
 * the page, whose read runs on every app open.
 */
export function useActivityArchive(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: activityArchiveKeys.chapter(chapterId!),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/activity/archive", {
        signal,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && (options.enabled ?? true),
  });
}
