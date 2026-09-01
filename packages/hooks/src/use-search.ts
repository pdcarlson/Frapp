"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

// Spec default: global search ignores queries shorter than 3 characters
// (spec/behavior/search.md). Gate the request so short queries never hit the API.
export const SEARCH_MIN_QUERY_LENGTH = 3;

/** A source name as it appears in `x-search-timeout-sources` and in the search payload's own keys. */
export type SearchSource = "backwork" | "events" | "members" | "messages";

/**
 * Search payload plus the per-source timeout signal (spec/behavior/search.md
 * "Server-side timeout"). The 500ms budget applies per source, not to the
 * request as a whole, so a slow chat scan degrades alone — `timedOut` can be
 * true while `payload` still carries real hits from the other three sources.
 * The client is required to render "we stopped looking here" differently
 * from "we found nothing"; dropping these headers (as a bare `data` return
 * used to) makes the two indistinguishable.
 */
export interface SearchResponse<T> {
  payload: T;
  timedOut: boolean;
  timedOutSources: SearchSource[];
}

function isSearchSource(value: string): value is SearchSource {
  return (
    value === "backwork" ||
    value === "events" ||
    value === "members" ||
    value === "messages"
  );
}

export function useSearch(query: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["search", chapterId, query],
    queryFn: async (): Promise<SearchResponse<unknown>> => {
      const { data, error, response } = await client.GET("/v1/search", {
        params: { query: { q: query } },
      });
      if (error) throw error;
      return {
        payload: data,
        timedOut: response.headers.get("x-search-timeout") === "1",
        timedOutSources: (response.headers.get("x-search-timeout-sources") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(isSearchSource),
      };
    },
    staleTime: 0,
    enabled: !!chapterId && query.trim().length >= SEARCH_MIN_QUERY_LENGTH,
  });
}
