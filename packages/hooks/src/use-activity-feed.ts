"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The chapter Activity Feed (`GET /v1/activity-feed`, `spec/behavior/activity-feed.md`).
 *
 * No web or mobile surface renders this yet — both home screens were
 * redirected/repurposed away by later product decisions (the web chat
 * redirect, the mobile Signet rebuild's chat-home). This hook exists so the
 * one non-trivial part (chapter-scoped, permission-aware aggregation) has a
 * single, shared, cache-consistent home once a screen is designed to use it,
 * rather than each client re-fetching and re-normalizing the same rows.
 */
export function useActivityFeed(limit?: number) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["activity-feed", chapterId, limit],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/activity-feed", {
        params: { query: limit !== undefined ? { limit } : {} },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId,
  });
}
