import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createHistoryPageFetcher,
  readNewestPage,
  type FetchHistoryPage,
} from "@repo/chat-core/history";
import { chatMessagesKey } from "@repo/chat-core/types";
import { useFrappClient } from "@repo/hooks";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * How long a channel's messages stay cached once no screen shows them. The
 * thread's own query (`use-chat-channel.ts`) and every prefetch below use the
 * same value, so a prefetched page outlives the walk from chat home to the
 * channel.
 */
export const CHANNEL_MESSAGES_GC_TIME = 30 * 60_000;

/**
 * At most this many unread channels are read ahead when chat home shows
 * (`usePrefetchUnreadChannels`): the ones a member is most likely to open
 * next, without a chapter of 100 channels reading them all on every launch.
 */
export const UNREAD_PREFETCH_LIMIT = 6;

/**
 * Read a channel's newest page into the cache the thread screen reads, unless
 * it is already there.
 *
 * The same read the thread's own query makes (`readNewestPage`), into the same
 * key with the same `staleTime: Infinity`, so the thread finds the rows and
 * paints them at once rather than its skeleton (#3699). What arrives after
 * the read is the thread's realtime join's to fetch when it opens
 * (`mergeSincePage`), as for a channel the member left a few minutes ago.
 *
 * A failed read is dropped: the thread then reads for itself, as it always
 * did. Nothing here must ever surface an error on chat home.
 */
export function prefetchChannelMessages(
  queryClient: QueryClient,
  fetchPage: FetchHistoryPage,
  channelId: string,
): void {
  void queryClient
    .prefetchQuery({
      queryKey: chatMessagesKey(channelId),
      queryFn: async () =>
        (await readNewestPage(queryClient, channelId, fetchPage)).cache,
      staleTime: Infinity,
      gcTime: CHANNEL_MESSAGES_GC_TIME,
    })
    .catch(() => undefined);
}

/** A stable `prefetch(channelId)` for a row's press-in. */
export function usePrefetchChannel(): (channelId: string) => void {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  const fetchPage = useMemo(
    () => createHistoryPageFetcher(apiClient, getSupabaseClient()),
    [apiClient],
  );
  return useCallback(
    (channelId: string) =>
      prefetchChannelMessages(queryClient, fetchPage, channelId),
    [queryClient, fetchPage],
  );
}

/**
 * Read ahead the first {@link UNREAD_PREFETCH_LIMIT} unread channels while
 * `enabled` (chat home focused, its list and the viewer known). Each id is
 * read once per cache life: `prefetchQuery` skips a key it already holds.
 */
export function usePrefetchUnreadChannels(
  unreadChannelIds: readonly string[],
  enabled: boolean,
): void {
  const prefetch = usePrefetchChannel();
  const key = unreadChannelIds.slice(0, UNREAD_PREFETCH_LIMIT).join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    for (const channelId of key.split(",")) prefetch(channelId);
  }, [enabled, key, prefetch]);
}
