import AsyncStorage from "@react-native-async-storage/async-storage";
import { dayDelta, formatClockShort, formatDayHeading } from "@repo/formatting";
import { isAnnouncementChannel } from "@repo/validation";

/** Away this long from Chat before the card says what happened (#5464). */
export const AWAY_AFTER_MS = 8 * 60 * 60 * 1000;
/** The most conversations the card lists. */
export const AWAY_ROWS_MAX = 3;
/** How often an open Chat records that the member is still here. */
export const AWAY_HEARTBEAT_MS = 5 * 60 * 1000;

export type AwayRowKind = "mention" | "announcement" | "busy";

export interface AwayRow {
  channelId: string;
  name: string;
  kind: AwayRowKind;
  /** Mentions on a mention row; a plain unread channel carries no number. */
  mentions: number;
  /** The channel's last message as the channel list draws it, or null. */
  preview: string | null;
}

/**
 * What the "while you were away" card lists (#5464; Slack's catch-up and
 * Activity are the comparables): channels with something new since the
 * member left, a mention first (most mentions first), then the announcements
 * channel, then the busiest, up to three. Only channels Chat home lists (no
 * direct messages, which the Messages tab carries).
 *
 * - **Since they left.** A channel counts only when its latest message is
 *   newer than `since`: unread from before the absence isn't news.
 * - **Muted stays quiet** unless the member was named in it. While the
 *   member's muting isn't known (`mutedIds` undefined), only mentions and
 *   announcements are listed, so a muted channel is never shown by mistake.
 * - **`onlyIds`**: once the card has opened, it lists only the channels it
 *   opened with, so it leaves when those are read and never fills back up.
 *
 * Every word is the real last message, so the card is the same with AI or
 * without.
 */
export function awayRows(input: {
  channels: readonly { id: string; name: string }[];
  unread: ReadonlyMap<string, { unreadCount: number; mentionCount: number }>;
  announcementIds: ReadonlySet<string>;
  mutedIds: ReadonlySet<string> | undefined;
  /** Each channel's latest message time. */
  latestAt: ReadonlyMap<string, string>;
  since: number;
  onlyIds?: ReadonlySet<string> | null;
  previewOf?: (channelId: string) => string | null;
}): AwayRow[] {
  const ORDER: Record<AwayRowKind, number> = {
    mention: 0,
    announcement: 1,
    busy: 2,
  };
  const rows: AwayRow[] = [];
  const unreadOf = (row: AwayRow) =>
    input.unread.get(row.channelId)?.unreadCount ?? 0;
  for (const channel of input.channels) {
    if (input.onlyIds && !input.onlyIds.has(channel.id)) continue;
    const counts = input.unread.get(channel.id);
    if (!counts || counts.unreadCount <= 0) continue;
    const at = Date.parse(input.latestAt.get(channel.id) ?? "");
    if (Number.isNaN(at) || at <= input.since) continue;
    const mentioned = counts.mentionCount > 0;
    const kind: AwayRowKind = mentioned
      ? "mention"
      : input.announcementIds.has(channel.id)
        ? "announcement"
        : "busy";
    if (
      kind === "busy" &&
      (!input.mutedIds || input.mutedIds.has(channel.id))
    ) {
      continue;
    }
    if (kind === "announcement" && input.mutedIds?.has(channel.id)) continue;
    rows.push({
      channelId: channel.id,
      name: channel.name,
      kind,
      mentions: counts.mentionCount,
      preview: input.previewOf?.(channel.id) ?? null,
    });
  }
  return rows
    .sort(
      (a, b) =>
        ORDER[a.kind] - ORDER[b.kind] ||
        b.mentions - a.mentions ||
        unreadOf(b) - unreadOf(a),
    )
    .slice(0, AWAY_ROWS_MAX);
}

/**
 * When the member was last on Chat, so the card shows only after time away:
 * the previous visit when it was at least {@link AWAY_AFTER_MS} ago, else
 * null. A first visit has none.
 */
export function awaySince(previous: number | null, now: number): number | null {
  if (previous === null || Number.isNaN(previous)) return null;
  return now - previous >= AWAY_AFTER_MS ? previous : null;
}

function visitKey(userId: string, chapterId: string): string {
  return `frapp.chat.lastVisit.${userId}.${chapterId}`;
}

export async function readLastChatVisit(
  userId: string,
  chapterId: string,
): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(visitKey(userId, chapterId));
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

export function writeLastChatVisit(
  userId: string,
  chapterId: string,
  at: number,
): void {
  AsyncStorage.setItem(visitKey(userId, chapterId), String(at)).catch(() => {
    /* Best-effort: the card then waits for a later visit to say anything. */
  });
}

/**
 * "since 6:15 AM", "since yesterday 9:40 PM", "since Monday 9:40 PM", or
 * "since November 2" further back, in the device's own locale.
 */
export function awaySinceLabel(since: number, now: number): string {
  const at = new Date(since);
  const days = dayDelta(at, new Date(now));
  const time = formatClockShort(at);
  if (days <= 0) return `since ${time}`;
  if (days === 1) return `since yesterday ${time}`;
  if (days < 7) {
    return `since ${at.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  }
  // Further back: the date, as a day heading writes a past day.
  return `since ${formatDayHeading(at, new Date(now)) ?? ""}`;
}

/**
 * The announcements channels in the channel list's raw read, by the shared
 * rule (`isAnnouncementChannel`): public, read-only, named for
 * announcements. The list's summaries leave `is_read_only` out, so this reads
 * the rows as served.
 */
export function announcementChannelIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(data)) return ids;
  for (const row of data as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const { id, name, type, is_read_only } = row as Record<string, unknown>;
    if (
      typeof id === "string" &&
      typeof name === "string" &&
      typeof type === "string" &&
      isAnnouncementChannel({ name, type, is_read_only: is_read_only === true })
    ) {
      ids.add(id);
    }
  }
  return ids;
}
