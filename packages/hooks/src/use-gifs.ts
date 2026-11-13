import { throwUnlessOk, type components } from "@repo/api-sdk";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useDebouncedValue } from "./use-debounced-value";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * GIF search for chat's GIF picker (#4631), web and phone. The API holds the
 * provider key and the PG-13 ceiling; these hooks only page through
 * `/v1/gifs/*`. Behavior: `spec/behavior/chat/README.md` § GIFs.
 */
export const gifKeys = createChapterQueryKeys("gifs");

export type GifRendition = components["schemas"]["GifRenditionDto"];

/** One picker result. Send its `token` with the GIF: the API refuses one without. */
export type GifResult = components["schemas"]["GifResultDto"];

/**
 * What a send carries for a picked result: the full rendition, which the
 * message shows, and the token the API signed the result with. The shape of
 * chat-core's `OutgoingGif`, restated because `@repo/hooks` does not depend on
 * chat-core.
 */
export interface GifToSend {
  provider: string;
  id: string;
  title: string;
  url: string;
  width: number;
  height: number;
  token: string;
}

export function gifToSend(gif: GifResult, provider: string): GifToSend {
  return {
    provider: provider.toLowerCase(),
    id: gif.id,
    title: gif.title,
    url: gif.full.url,
    width: gif.full.width,
    height: gif.full.height,
    token: gif.token,
  };
}

/** How long a typed search waits for the member to stop typing. */
export const GIF_SEARCH_DEBOUNCE_MS = 300;

/**
 * Whether this server has GIF search set up. The composer hides its GIF
 * button until this says yes, so an unset key never shows a broken picker.
 * A failed read reads as "not set up", for the same reason.
 */
export function useGifAvailability() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const query = useQuery({
    queryKey: gifKeys.detail(chapterId!, "availability"),
    queryFn: async () => {
      const result = await client.GET("/v1/gifs/availability");
      throwUnlessOk(result);
      return result.data!;
    },
    staleTime: 30 * 60_000,
    enabled: !!chapterId,
  });
  return {
    available: query.data?.available === true,
    provider: query.data?.provider ?? "",
  };
}

/**
 * Trending GIFs for a blank search, else search results, a page at a time.
 * `query` is what the member typed; it is debounced here, so the caller
 * passes the field's value straight through. Holds the previous results on
 * screen while the next search loads, so the grid never flashes empty.
 */
export function useGifSearch(query: string, enabled = true) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const settled = useDebouncedValue(query.trim(), GIF_SEARCH_DEBOUNCE_MS);
  const result = useInfiniteQuery({
    queryKey: gifKeys.list(chapterId!, { q: settled }),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const page = pageParam as number;
      const response = settled
        ? await client.GET("/v1/gifs/search", {
            params: { query: { q: settled, page } },
          })
        : await client.GET("/v1/gifs/trending", {
            params: { query: { page } },
          });
      throwUnlessOk(response);
      return response.data!;
    },
    getNextPageParam: (last) => last.next_page ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    enabled: enabled && !!chapterId,
  });
  const results: GifResult[] = [];
  const seen = new Set<string>();
  for (const page of result.data?.pages ?? []) {
    for (const gif of page.results) {
      if (seen.has(gif.id)) continue;
      seen.add(gif.id);
      results.push(gif);
    }
  }
  return {
    results,
    isLoading: result.isLoading,
    isError: result.isError,
    /** True between a keystroke and its results replacing the old ones. */
    isSearching:
      query.trim() !== settled ||
      (result.isFetching && result.isPlaceholderData),
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
    /** The last next-page load failed; nothing loads more until a retry. */
    isFetchNextPageError: result.isFetchNextPageError,
    fetchNextPage: result.fetchNextPage,
    refetch: result.refetch,
  };
}
