/**
 * Narrowing and grouping for s14 (Notifications), over `GET /v1/notifications`.
 *
 * What a row looks like (its picture, its kind's badge, the name's colour, the
 * mention chips) is `@repo/hooks/notification-rows`, shared with the web
 * drawer (#4346), and needs the viewer and the roster, so the screen works it
 * out from `title`, `body` and `data` here. This module only narrows the
 * rows, resolves where a tap goes, and groups them by day.
 *
 * The category word that sat under each row ("Events · 4:00 PM") was derived
 * from `data.target.screen` here until #4346; the kind's badge or tile says it
 * now, and its words are read to a screen reader.
 */
import {
  groupNotificationsBySource,
  notificationEntryCount,
  notificationWhen,
  type NotificationFilter,
} from "@repo/hooks/notification-rows";
import { isRecord, records, str } from "./narrow";
import {
  resolveNotificationTarget,
  type NotificationTarget,
} from "../notifications/targets";

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  /** The row's `data`, as served, for `notificationLook`. */
  data: unknown;
  /**
   * Where tapping the row goes.
   *
   * Resolved by `lib/notifications/targets.ts`, the same module the push
   * handler uses — an in-app tap and a notification tap name the same
   * destination, so they must not grow two rules. Never `null`: an
   * unrecognized target resolves to the notification list, which is where the
   * member already is, so the row simply does not navigate away. Opened with
   * `openNotificationTarget`, so a thread reply's row lands on the thread over
   * its channel, as its push does (#4054).
   */
  target: NotificationTarget;
  /** Local clock time, e.g. `"4:00 PM"`. */
  time: string;
  createdAt: string;
  /** Unread while any row in the entry is (#3948). */
  isUnread: boolean;
  /**
   * "14 messages" when the entry stands for a conversation's rows, newest
   * first, collapsed into one (#3948); absent or `null` for a single row.
   */
  count?: string | null;
  /**
   * Ids of the entry's unread rows, which opening it reads (#3948); absent
   * means just `id` when `isUnread`.
   */
  unreadIds?: string[];
  /**
   * Every row id the entry stands for, newest first, which a clear removes
   * (#3948); absent means just `id`.
   */
  ids?: string[];
}

export interface NotificationGroup {
  /** `TODAY` / `EARLIER`, as drawn. */
  heading: string;
  rows: NotificationRow[];
}

function targetScreen(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const target = data.target;
  return isRecord(target) ? str(target, "screen") : null;
}

function toRow(
  row: Record<string, unknown>,
  now: Date,
): (NotificationRow & { isToday: boolean }) | null {
  const id = str(row, "id");
  const title = str(row, "title");
  const createdAt = str(row, "created_at");
  if (!id || !title || !createdAt) return null;

  // The day and time by the web drawer's own rule (`notificationWhen`).
  const when = notificationWhen(createdAt, now);
  if (!when) return null;

  return {
    id,
    title,
    body: str(row, "body"),
    data: row.data,
    target: resolveNotificationTarget(row.data),
    time: when.time,
    createdAt,
    // `read_at` is nullable and set on read; absent means unread.
    isUnread: str(row, "read_at") === null,
    isToday: when.isToday,
  };
}

/**
 * Entries grouped TODAY / EARLIER, newest first within each, as drawn.
 *
 * One entry per conversation (`groupNotificationsBySource`, shared with the
 * web drawer, #3948): a channel's rows collapse into its newest, which says
 * how many messages it stands for and is unread while any of them is. Under
 * `"unread"` read rows are left out first. An entry sits on its newest row's
 * day. Empty groups are dropped so a member with only older activity does not
 * see a TODAY heading over nothing.
 */
export function selectNotificationGroups(
  data: unknown,
  now: Date,
  filter: NotificationFilter = "all",
): NotificationGroup[] {
  const sorted = records(data)
    .map((row) => toRow(row, now))
    .filter((row): row is NotificationRow & { isToday: boolean } => !!row)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows = groupNotificationsBySource(sorted, {
    isUnread: (row) => row.isUnread,
    filter,
  }).map((entry) => ({
    ...entry.lead,
    isUnread: entry.unreadIds.length > 0,
    count: notificationEntryCount(entry),
    unreadIds: entry.unreadIds,
    ids: entry.rows.map((row) => row.id),
  }));

  const groups: NotificationGroup[] = [
    { heading: "TODAY", rows: rows.filter((row) => row.isToday) },
    { heading: "EARLIER", rows: rows.filter((row) => !row.isToday) },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

/** Ids of every unread row: whether anything is left for "Mark all read". */
export function selectUnreadIds(data: unknown): string[] {
  return records(data)
    .filter((row) => str(row, "read_at") === null)
    .map((row) => str(row, "id"))
    .filter((id): id is string => !!id);
}

/**
 * Ids of read rows whose target is **not** chat: the in-app rows whose pushes
 * `clearReadNonChatNotifications` may take out of the tray (#4011). Chat rows
 * are left to the channel counts (`clearReadChatNotifications`).
 */
export function selectReadNonChatIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  for (const row of records(data)) {
    if (str(row, "read_at") === null || targetScreen(row.data) === "chat") {
      continue;
    }
    const id = str(row, "id");
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Count of unread rows whose target is **not** chat.
 *
 * The API's chat push worker writes a `notifications` row
 * (`target.screen: "chat"`) for every chat push it sends (DMs, group DMs,
 * announcements, mentions, and any channel at level `all`), on top of the
 * read-receipt count `useChannelUnreadCounts` already returns for that same
 * channel — see `chat-push-worker.service.ts`'s `buildPayload`. Summing
 * `selectUnreadIds`'s total with the channel-unread total would therefore
 * double-count exactly those messages. The app-icon badge (`use-badge-sync.ts`) needs this
 * exclusion; "Mark all read" does not — it must still clear chat-sourced rows
 * — so this is a separate selector rather than a change to `selectUnreadIds`.
 */
export function selectUnreadNonChatCount(data: unknown): number {
  return records(data).filter(
    (row) => str(row, "read_at") === null && targetScreen(row.data) !== "chat",
  ).length;
}
