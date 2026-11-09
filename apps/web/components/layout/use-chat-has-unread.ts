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
 * Whether Chat has anything new the member would want to know about while the
 * channels are out of sight, which lights the nav's Chat row on every page
 * (#3824). It stays lit until the counts say the member has read it, and the
 * shell-wide inbox binding keeps the counts live off `/chat`
 * (`use-chat-realtime-binding.ts`, #3745). Two ways in, the same two the
 * channel list draws:
 *
 * - **Addressed**: an @-mention, or anything unread in a DM. It gets past a
 *   mute, as it does for push and for the list's Hide muted filter
 *   (`countsAddressMember`, foundations §5).
 * - **Unread in a channel known not to be muted.** Levels are read from the
 *   last good preferences, so a failed refetch keeps a muted channel muted;
 *   while they have never loaded, plain unread lights nothing.
 *
 * Counts are the server's (`GET /v1/channels/unread`, the read the list uses),
 * never a local re-derivation, and unknown counts light nothing.
 */
export function useChatHasUnread(): boolean {
  const unreadQuery = useChannelUnreadCounts();
  const prefsQuery = useChannelNotificationPreferences();
  const channelsQuery = useChannels();
  return useMemo(() => {
    const counts = sidebarUnreadCounts({
      data: unreadQuery.data,
      isError: unreadQuery.isError,
    });
    if (!counts) return false;
    const directIds = new Set(
      asArray<{ id: string; type: string }>(channelsQuery.data)
        .filter(isDirectChannel)
        .map((c) => c.id),
    );
    const levels = prefsQuery.data
      ? new Map(prefsQuery.data.map((row) => [row.channel_id, row.level]))
      : undefined;
    for (const [channelId, c] of counts) {
      if (countsAddressMember(directIds.has(channelId), c)) return true;
      if (c.unreadCount > 0 && levels && levels.get(channelId) !== "off") {
        return true;
      }
    }
    return false;
  }, [
    unreadQuery.data,
    unreadQuery.isError,
    prefsQuery.data,
    channelsQuery.data,
  ]);
}
