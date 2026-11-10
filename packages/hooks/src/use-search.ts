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

/** What a message can carry, as `GET /v1/search`'s `has` names it. */
export type SearchHasTrait = "file" | "image" | "link" | "poll";

/**
 * Narrowing for the `messages` source (spec/behavior/search.md § Single-channel
 * scope and § Message filters). Any of them makes the search messages-only.
 */
export interface SearchFilters {
  /** One chat channel. On its own it still needs three characters of text. */
  channelId?: string;
  /** Messages from this sender only. */
  fromUserId?: string;
  /** Sent at or after this instant: ISO 8601 with an explicit offset, never a bare date. */
  after?: string;
  /** Sent strictly before this instant, in the same form. */
  before?: string;
  /** Carries every listed trait. */
  has?: readonly SearchHasTrait[];
}

/** True when a sender, date or content filter is set. A channel alone is not one. */
export function hasMessageFilter(filters: SearchFilters | undefined): boolean {
  return Boolean(
    filters &&
    (filters.fromUserId ||
      filters.after ||
      filters.before ||
      (filters.has && filters.has.length > 0)),
  );
}

/**
 * The API's own rule for what it will search (`search.service.ts`): three or
 * more characters, or no text at all beside a sender, date or content filter.
 * One or two characters are refused either way, and so is empty text with only
 * a channel.
 */
export function isSearchRunnable(
  query: string,
  filters?: SearchFilters,
): boolean {
  const length = query.trim().length;
  if (length >= SEARCH_MIN_QUERY_LENGTH) return true;
  return length === 0 && hasMessageFilter(filters);
}

/**
 * Cross-domain search, or, when `filters` narrows it, the message search
 * `spec/behavior/chat/README.md` specifies.
 *
 * Narrowing is deliberately **not** something a caller can do by filtering
 * this hook's results: `SEARCH_LIMIT` is applied by the database across every
 * channel the caller can read, so a channel (or sender, or week) whose matches
 * rank below that cut would come back empty and be indistinguishable from one
 * with no matches at all. Narrowing has to reach SQL, which is why every
 * filter is a request parameter and part of the query key.
 */
export function useSearch(query: string, filters?: SearchFilters) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const channelId = filters?.channelId;
  const fromUserId = filters?.fromUserId;
  const after = filters?.after;
  const before = filters?.before;
  // Sorted so the key and the request do not depend on the order the member
  // ticked the traits in.
  const has = filters?.has?.length ? [...filters.has].sort().join(",") : null;
  return useQuery({
    queryKey: [
      "search",
      chapterId,
      query,
      channelId ?? null,
      fromUserId ?? null,
      after ?? null,
      before ?? null,
      has,
    ],
    queryFn: async (): Promise<SearchResponse<unknown>> => {
      const { data, error, response } = await client.GET("/v1/search", {
        params: {
          query: {
            q: query,
            ...(channelId ? { channelId } : {}),
            ...(fromUserId ? { fromUserId } : {}),
            ...(after ? { after } : {}),
            ...(before ? { before } : {}),
            ...(has ? { has } : {}),
          },
        },
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
    enabled: !!chapterId && isSearchRunnable(query, filters),
  });
}
