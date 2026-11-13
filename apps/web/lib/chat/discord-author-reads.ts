import type { Query, QueryClient } from "@tanstack/react-query";
import {
  CHAT_MESSAGE_QUERY_ROOT,
  chatMessagesChannelId,
  type ChannelCache,
} from "@repo/chat-core/types";

/**
 * What the web chat caches after a member links or unlinks their Discord
 * account (#2878, #4543). Linking and unlinking change on the server who an
 * imported message's sender is, and imported messages never arrive over
 * Realtime, so nothing else would tell an open thread.
 *
 * **Threads no screen shows are dropped**, and read fresh on the next visit.
 *
 * **An open thread is refetched when it holds imported messages by one of
 * `discordUserIds`.** A timeline is cached with `staleTime: Infinity`
 * (`use-chat-channel.ts`), and its refetch returns it to its newest page,
 * dropping the older pages the member scrolled through (#1571); pending sends
 * survive it (`reconcileNewestPage`). So, as `reported-message-reads.ts` does
 * for a removal, only the timelines whose cache holds a row by one of those
 * accounts (`author_external_id`) are refetched, and the others are left as
 * they are. The caller names every account whose rows the change moved: the
 * one unlinked, or on a link both the new account and the one it replaced,
 * whose rows go back to their Discord name. `null` means the caller can't name
 * them (a link status not read yet, or read from an API older than #4543), and
 * every open thread holding any imported row is refetched.
 *
 * **An open thread whose read is still in flight is read again.** On a link,
 * the browser has just come back from Discord, so the open thread's first
 * read can be under way while the link commits; that read may predate the
 * link, and its cache holds nothing yet to match. TanStack Query joins an
 * invalidate of a query with no data onto the read already out rather than
 * restarting it, so such reads are cancelled first, then fetched afresh.
 */
export async function refreshTimelinesForDiscordAuthor(
  queryClient: QueryClient,
  discordUserIds: readonly string[] | null,
): Promise<void> {
  queryClient.removeQueries({
    queryKey: [CHAT_MESSAGE_QUERY_ROOT],
    type: "inactive",
  });

  const isTimeline = (query: Query) =>
    chatMessagesChannelId(query.queryKey) !== null;
  const inFlight = new Set(
    queryClient
      .getQueryCache()
      .findAll({ queryKey: [CHAT_MESSAGE_QUERY_ROOT], type: "active" })
      .filter(
        (query) => isTimeline(query) && query.state.fetchStatus === "fetching",
      ),
  );
  await Promise.all([...inFlight].map((query) => query.cancel()));

  const authors = discordUserIds === null ? null : new Set(discordUserIds);
  await queryClient.invalidateQueries({
    queryKey: [CHAT_MESSAGE_QUERY_ROOT],
    type: "active",
    predicate: (query) => {
      if (!isTimeline(query)) return false;
      if (inFlight.has(query)) return true;
      const cache = query.state.data as ChannelCache | undefined;
      if (!cache) return false;
      return Object.values(cache.byId).some((message) =>
        authors === null
          ? message.author_external_id != null
          : message.author_external_id != null &&
            authors.has(message.author_external_id),
      );
    },
  });
}
