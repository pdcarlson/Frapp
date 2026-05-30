"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

// Spec default: global search ignores queries shorter than 3 characters
// (spec/behavior/search.md). Gate the request so short queries never hit the API.
export const SEARCH_MIN_QUERY_LENGTH = 3;

export function useSearch(query: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["search", chapterId, query],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/search", {
        params: { query: { q: query } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!chapterId && query.trim().length >= SEARCH_MIN_QUERY_LENGTH,
  });
}
