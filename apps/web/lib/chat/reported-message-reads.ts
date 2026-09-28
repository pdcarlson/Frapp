import type { QueryClient } from "@tanstack/react-query";
import {
  CHAT_MESSAGE_QUERY_ROOT,
  chatMessagesKey,
  markMessageDeleted,
  type ChannelCache,
} from "@repo/chat-core";
import type { ReportedMessageTimeline } from "@repo/hooks";

/**
 * The web chat timeline's half of an officer's report-scoped removal (#2311):
 * `useRemoveReportedMessage` (`@repo/hooks`) hands it the outcome, and this
 * applies it to `@repo/chat-core`'s normalized cache, which the hooks package
 * does not depend on.
 *
 * **Patch, don't refetch, when the channel is known.** `use-chat-channel.ts`
 * caches a timeline under `chatMessagesKey` with `staleTime: Infinity`, and its
 * `queryFn` returns the timeline to its newest page, dropping the older
 * pages the officer had scrolled through (#1571). `markMessageDeleted` writes
 * the same tombstone the server does into the one row, and leaves every other
 * row — outbox rows included — where it was. Only a channel the officer can read can be cached here at all;
 * a DM they are not in never is, and the patch is then a no-op.
 *
 * **Refetch only what holds the message when the outcome is unknown.** A 5xx or
 * a transport failure names no channel, and the removal may or may not have
 * landed, so a patch would be a guess. The timelines whose cache holds the
 * message are refetched. A refetch keeps no row it did not re-read, so the
 * removed row either comes back as the server has it (it is in the newest
 * page) or leaves the timeline until the officer scrolls back to it, when it
 * loads fresh; the removed content is never kept. Every other timeline is
 * left alone.
 */
export const reportedMessageTimeline: ReportedMessageTimeline = {
  markRemoved(queryClient, channelId, messageId) {
    queryClient.setQueryData<ChannelCache>(
      chatMessagesKey(channelId),
      (cache) => (cache ? markMessageDeleted(cache, messageId) : cache),
    );
  },
  refetchHolding(queryClient, messageId) {
    void refetchTimelinesHolding(queryClient, messageId);
  },
};

function refetchTimelinesHolding(queryClient: QueryClient, messageId: string) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const [root, , leaf] = query.queryKey;
      if (root !== CHAT_MESSAGE_QUERY_ROOT || leaf !== "messages") return false;
      const cache = query.state.data as ChannelCache | undefined;
      return cache?.byId[messageId] !== undefined;
    },
  });
}
