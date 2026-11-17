import { useMemo } from "react";
import {
  channelsWithUnreadThreads,
  sidebarUnreadCounts,
  useChannels,
} from "@repo/hooks";
import { useChannelThreads } from "@/components/chat/channel-thread-rows";
import {
  isDirectChannel,
  listedChannels,
  selectChannels,
} from "@/lib/chat/channel-list";
import { useShownUnreadCounts } from "@/lib/chat/unread-first-paint";

/**
 * How many of the member's conversations (DMs and group DMs) have anything
 * unread: the Messages tab's badge (#5310). It was the badge on Chat home's
 * Messages door until the tab replaced the door, and moved here with it.
 *
 * A muted DM counts too: anything unread in a DM addresses the member, and
 * that gets past a mute, as it does on the row and for push
 * (`spec/behavior/chat/README.md` § Sidebar arrangement, Hide muted). A group
 * DM whose thread has new replies counts too (#5277): thread replies never
 * count toward the conversation's own unread, so without this a new reply
 * would leave no mark on the tab.
 *
 * The counts are the ones the rows draw (`useShownUnreadCounts`), so the tab
 * and the list under it agree. `0` while the counts are unknown.
 */
export function useUnreadConversationCount(): number {
  const channelsQuery = useChannels();
  const unread = useShownUnreadCounts();
  const { byChannel: threadsByChannel } = useChannelThreads();

  const directChannels = useMemo(
    () =>
      listedChannels(selectChannels(channelsQuery.data)).filter(
        isDirectChannel,
      ),
    [channelsQuery.data],
  );
  const unreadByChannelId = useMemo(
    () => sidebarUnreadCounts({ data: unread.data, isError: unread.isError }),
    [unread.data, unread.isError],
  );
  const unreadThreadChannelIds = useMemo(
    () => channelsWithUnreadThreads(threadsByChannel),
    [threadsByChannel],
  );
  return directChannels.filter(
    (channel) =>
      (unreadByChannelId?.get(channel.id)?.unreadCount ?? 0) > 0 ||
      unreadThreadChannelIds.has(channel.id),
  ).length;
}

/** The tab's spoken count: "2 unread conversations", or nothing at zero. */
export function unreadConversationsSpoken(count: number): string | null {
  if (count <= 0) return null;
  return `${count} unread ${count === 1 ? "conversation" : "conversations"}`;
}
