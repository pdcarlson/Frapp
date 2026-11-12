import { useEffect, useMemo } from "react";
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
 * thread's own query (`use-chat-channel.ts`) and the read-ahead below use the
 * same value, so a page read ahead outlives the walk from chat home to the
 * channel.
 */
export const CHANNEL_MESSAGES_GC_TIME = 30 * 60_000;

/**
 * At most this many unread channels are read ahead when chat home shows
 * (`usePrefetchUnreadChannels`): enough for the ones a member is likely to
 * open next, without a chapter of 100 channels reading them all on launch.
 */
export const UNREAD_PREFETCH_LIMIT = 6;

/**
 * Channels whose cached page came from a read-ahead and that no thread has
 * shown since. The thread takes the id when it opens (`takeReadAhead`) and
 * reads the newest page again behind the rows it already shows: nothing kept
 * a read-ahead page current (no realtime subscription covers a channel nobody
 * has open, and the join's backfill adds only newer rows, not edits, deletes,
 * votes or reactions), and only the thread's own read records where a short
 * channel's history starts.
 */
const readAhead = new Set<string>();

/**
 * Whether `channelId`'s cache came from a read-ahead no thread has shown yet.
 * Forgets it, so the thread re-reads once per read-ahead, not on every mount.
 */
export function takeReadAhead(channelId: string): boolean {
  return readAhead.delete(channelId);
}

/**
 * Read a channel's newest page into the cache the thread screen reads, unless
 * it is already there.
 *
 * The thread's own newest-page read (`readNewestPage`), into the same key with
 * the same `staleTime: Infinity`, so the thread finds the rows and paints them
 * as it slides in rather than its skeleton (#3699), then refreshes them
 * ({@link takeReadAhead}).
 *
 * A failed read is dropped: the thread then reads for itself, as it always
 * did. Nothing here must ever surface an error on chat home.
 */
export function prefetchChannelMessages(
  queryClient: QueryClient,
  fetchPage: FetchHistoryPage,
  channelId: string,
): void {
  const key = chatMessagesKey(channelId);
  if (queryClient.getQueryData(key) !== undefined) return;
  void queryClient
    .prefetchQuery({
      queryKey: key,
      queryFn: async () => {
        const { cache } = await readNewestPage(
          queryClient,
          channelId,
          fetchPage,
        );
        readAhead.add(channelId);
        return cache;
      },
      staleTime: Infinity,
      gcTime: CHANNEL_MESSAGES_GC_TIME,
    })
    .catch(() => undefined);
}

/**
 * Read ahead the first {@link UNREAD_PREFETCH_LIMIT} of `unreadChannelIds`
 * while `enabled`. A channel already cached is skipped, so each is read at
 * most once per cache life.
 */
export function usePrefetchUnreadChannels(
  unreadChannelIds: readonly string[],
  enabled: boolean,
): void {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  const fetchPage = useMemo(
    () => createHistoryPageFetcher(apiClient, getSupabaseClient()),
    [apiClient],
  );
  const key = unreadChannelIds.slice(0, UNREAD_PREFETCH_LIMIT).join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    for (const channelId of key.split(",")) {
      prefetchChannelMessages(queryClient, fetchPage, channelId);
    }
  }, [enabled, key, queryClient, fetchPage]);
}
