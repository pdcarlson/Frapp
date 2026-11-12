"use client";

import { useMemo } from "react";
import {
  countsAddressMember,
  sidebarUnreadCounts,
  useChannelNotificationPreferences,
  useChannelUnreadCounts,
  useChannels,
} from "@repo/hooks";
import { isDirectChannel } from "@repo/validation";
import { asArray } from "@/lib/utils";

/**
 * What is new in chat while it is out of sight, split the way the nav splits
 * it (#3774): the Chat row lights for the chapter's channels, and the Direct
 * messages row counts conversations. Both stay until the counts say the member
 * has read them, and the shell-wide inbox binding keeps the counts live off
 * `/chat` (`use-chat-realtime-binding.ts`, #3745).
 *
 * - **Channels** light the Chat row (#3824) two ways, the same two the channel
 *   list draws: an @-mention, which gets past a mute as it does for push and
 *   for the list's Hide muted filter (`countsAddressMember`, foundations §5);
 *   or anything unread in a channel known not to be muted. Levels are read
 *   from the last good preferences, so a failed refetch keeps a muted channel
 *   muted; while they have never loaded, plain unread lights nothing.
 * - **Direct messages** are counted, not lit: the number of conversations
 *   with anything unread, the count the phone's Messages door shows. A direct
 *   message addresses the member, so it counts past a mute.
 *
 * Counts are the server's (`GET /v1/channels/unread`, the read the list uses),
 * never a local re-derivation, and unknown counts light nothing. Until the
 * channel list has loaded a row's kind is unknown, and it is read as a
 * channel, so a DM lights Chat for that moment rather than nothing at all.
 */
export type ChatUnread = {
  channels: boolean;
  directConversations: number;
};

const NOTHING_UNREAD: ChatUnread = { channels: false, directConversations: 0 };

export function useChatUnread(): ChatUnread {
  const unreadQuery = useChannelUnreadCounts();
  const prefsQuery = useChannelNotificationPreferences();
  const channelsQuery = useChannels();
  return useMemo(() => {
    const counts = sidebarUnreadCounts({
      data: unreadQuery.data,
      isError: unreadQuery.isError,
    });
    if (!counts) return NOTHING_UNREAD;
    const directIds = new Set(
      asArray<{ id: string; type: string }>(channelsQuery.data)
        .filter(isDirectChannel)
        .map((c) => c.id),
    );
    const levels = prefsQuery.data
      ? new Map(prefsQuery.data.map((row) => [row.channel_id, row.level]))
      : undefined;
    let channels = false;
    let directConversations = 0;
    for (const [channelId, c] of counts) {
      if (directIds.has(channelId)) {
        if (countsAddressMember(true, c)) directConversations += 1;
        continue;
      }
      if (countsAddressMember(false, c)) channels = true;
      else if (c.unreadCount > 0 && levels && levels.get(channelId) !== "off") {
        channels = true;
      }
    }
    if (!channels && directConversations === 0) return NOTHING_UNREAD;
    return { channels, directConversations };
  }, [
    unreadQuery.data,
    unreadQuery.isError,
    prefsQuery.data,
    channelsQuery.data,
  ]);
}

/**
 * Whether chat has anything new at all, channels or direct messages: the
 * phone-width menu button's dot, which stands for every row in the drawer.
 */
export function useChatHasUnread(): boolean {
  const unread = useChatUnread();
  return unread.channels || unread.directConversations > 0;
}

export type NavHighlights = {
  /** Rows lit with a dot: today only Chat. */
  highlighted: ReadonlySet<string>;
  /** Rows carrying a mention-red count: today only Direct messages. */
  counts: ReadonlyMap<string, number>;
};

const NO_HIGHLIGHTS: ReadonlySet<string> = new Set();
const CHAT_HIGHLIGHTED: ReadonlySet<string> = new Set(["chat"]);
const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/**
 * The nav rows with something new (`AppNav`'s `highlighted` and `counts`), on
 * every route and in the drawer until seen (#3824, #3774).
 *
 * Read by the nav itself (`NavColumn`, the shell's drawer), never by
 * `DashboardShell`'s body: the counts change with every message the inbox
 * reports, on every route, and only the nav has to redraw for it.
 */
export function useNavHighlights(): NavHighlights {
  const { channels, directConversations } = useChatUnread();
  return useMemo(
    () => ({
      highlighted: channels ? CHAT_HIGHLIGHTED : NO_HIGHLIGHTS,
      counts:
        directConversations > 0
          ? new Map([["direct", directConversations]])
          : NO_COUNTS,
    }),
    [channels, directConversations],
  );
}
