import type { QueryClient } from "@tanstack/react-query";
import {
  CHAT_MESSAGE_QUERY_ROOT,
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
 * **An open thread is refetched only when it holds that author's imported
 * messages.** A timeline is cached with `staleTime: Infinity`
 * (`use-chat-channel.ts`), and its refetch returns it to its newest page,
 * dropping the older pages the member scrolled through (#1571); pending sends
 * survive it (`reconcileNewestPage`). So, as `reported-message-reads.ts` does
 * for a removal, only the timelines whose cache holds a row the change
 * reattributes are refetched: rows whose `author_external_id` is the linked
 * account's Discord user id. A timeline holding none is left as it is.
 *
 * `discordUserId` is null only when the caller doesn't know the account (a
 * link status read from an API older than #4543); then every open thread
 * holding any imported row is refetched, since one of them may be the
 * member's.
 */
export function refreshTimelinesForDiscordAuthor(
  queryClient: QueryClient,
  discordUserId: string | null,
): Promise<void> {
  queryClient.removeQueries({
    queryKey: [CHAT_MESSAGE_QUERY_ROOT],
    type: "inactive",
  });
  return queryClient.invalidateQueries({
    queryKey: [CHAT_MESSAGE_QUERY_ROOT],
    type: "active",
    predicate: (query) => {
      if (query.queryKey[2] !== "messages") return false;
      const cache = query.state.data as ChannelCache | undefined;
      if (!cache) return false;
      return Object.values(cache.byId).some((message) =>
        discordUserId === null
          ? message.author_external_id != null
          : message.author_external_id === discordUserId,
      );
    },
  });
}
