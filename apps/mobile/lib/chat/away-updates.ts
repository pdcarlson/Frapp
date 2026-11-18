import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAnnouncementChannel } from "@repo/validation";

/** Away this long from Chat before the card says what happened (#5464). */
export const AWAY_AFTER_MS = 8 * 60 * 60 * 1000;
/** The most conversations the card lists. */
export const AWAY_ROWS_MAX = 3;

export type AwayRowKind = "mention" | "announcement" | "busy";

export interface AwayRow {
  channelId: string;
  name: string;
  kind: AwayRowKind;
  /** Mentions for a mention row; unread messages otherwise. */
  count: number;
  /** "Jordan: is the formal budget final?", the real last message, or null. */
  preview: string | null;
}

/**
 * What the "while you were away" card lists (#5464; Slack's catch-up and
 * Activity are the comparables): the channels with a mention first, most
 * mentions first, then the announcements channel, then the busiest, up to
 * three. Only channels Chat home lists (no direct messages, which the
 * Messages tab carries) and none the member muted. Every word is the real
 * last message, so the card is the same with AI or without.
 */
export function awayRows(input: {
  channels: readonly { id: string; name: string }[];
  unread: ReadonlyMap<string, { unreadCount: number; mentionCount: number }>;
  announcementIds: ReadonlySet<string>;
  mutedIds?: ReadonlySet<string>;
  latest?: readonly {
    channel_id: string;
    sender_id?: string | null;
    author_name: string | null;
    content: string;
  }[];
  /** A member's display name by `users.id`, for the preview's sender. */
  nameOf?: (userId: string) => string | undefined;
}): AwayRow[] {
  const latest = new Map((input.latest ?? []).map((m) => [m.channel_id, m]));
  const ORDER: Record<AwayRowKind, number> = {
    mention: 0,
    announcement: 1,
    busy: 2,
  };
  const rows: AwayRow[] = [];
  for (const channel of input.channels) {
    const counts = input.unread.get(channel.id);
    if (!counts || counts.unreadCount <= 0) continue;
    const mentioned = counts.mentionCount > 0;
    // A muted channel still says when the member was named.
    if (!mentioned && input.mutedIds?.has(channel.id)) continue;
    const kind: AwayRowKind = mentioned
      ? "mention"
      : input.announcementIds.has(channel.id)
        ? "announcement"
        : "busy";
    const last = latest.get(channel.id);
    const text = last?.content.replace(/\s+/g, " ").trim() ?? "";
    const author =
      last?.author_name ??
      (last?.sender_id ? input.nameOf?.(last.sender_id) : undefined) ??
      null;
    rows.push({
      channelId: channel.id,
      name: channel.name,
      kind,
      count: mentioned ? counts.mentionCount : counts.unreadCount,
      preview:
        text === "" ? null : author ? `${author.split(" ")[0]}: ${text}` : text,
    });
  }
  return rows
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.count - a.count)
    .slice(0, AWAY_ROWS_MAX);
}

/**
 * When the member was last on Chat, so the card shows only after time away:
 * the previous visit when it was at least {@link AWAY_AFTER_MS} ago, else
 * null. Per member and chapter, on the phone only; a first visit has none.
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

/** "since yesterday 9:40 PM", "since 2:15 PM", "since Monday 9:40 PM". */
export function awaySinceLabel(since: number, now: number): string {
  const time = new Date(since).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = (at: number) => {
    const d = new Date(at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(since)) / 86_400_000);
  if (days <= 0) return `since ${time}`;
  if (days === 1) return `since yesterday ${time}`;
  const weekday = new Date(since).toLocaleDateString("en-US", {
    weekday: "long",
  });
  return days < 7 ? `since ${weekday} ${time}` : "since last week";
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
      isAnnouncementChannel({
        name,
        type,
        is_read_only: is_read_only === true,
      })
    ) {
      ids.add(id);
    }
  }
  return ids;
}
