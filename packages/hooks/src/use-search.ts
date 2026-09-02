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

/**
 * Cross-domain search, or — when `channelId` is given — the single-channel
 * message search `spec/behavior/chat/README.md` specifies.
 *
 * The channel filter is deliberately **not** something a caller can do by
 * filtering this hook's results: `SEARCH_LIMIT` is applied by the database
 * across every channel the caller can read, so a channel whose matches rank
 * below that cut would come back empty and be indistinguishable from a channel
 * with no matches at all. Narrowing has to reach SQL, which is why it is a
 * request parameter and part of the query key.
 */
export function useSearch(query: string, channelId?: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["search", chapterId, query, channelId ?? null],
    queryFn: async (): Promise<SearchResponse<unknown>> => {
      const { data, error, response } = await client.GET("/v1/search", {
        params: { query: channelId ? { q: query, channelId } : { q: query } },
      });
      if (error) throw error;
      return {
        payload: data,
        timedOut: response.headers.get("x-search-timeout") === "1",
        timedOutSources: (
          response.headers.get("x-search-timeout-sources") ?? ""
        )
          .split(",")
          .map((s) => s.trim())
          .filter(isSearchSource),
      };
    },
    staleTime: 0,
    enabled: !!chapterId && query.trim().length >= SEARCH_MIN_QUERY_LENGTH,
  });
}
