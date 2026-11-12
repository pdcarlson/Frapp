/**
 * How many messages were new in a channel, from the unread counts Chat home
 * already holds (`useChannelUnreadCounts`), for Catch me up's "New messages"
 * range and its offer (#3946). `null` when the counts are not held, or hold
 * no row for the channel: unknown is not zero, and nothing is offered on it.
 */
export function arrivalUnread(
  counts: unknown,
  channelId: string | null,
): number | null {
  if (!channelId || !Array.isArray(counts)) return null;
  for (const row of counts as unknown[]) {
    if (
      row &&
      typeof row === "object" &&
      (row as { channel_id?: unknown }).channel_id === channelId
    ) {
      const count = (row as { unread_count?: unknown }).unread_count;
      return typeof count === "number" && count >= 0 ? count : null;
    }
  }
  return null;
}
