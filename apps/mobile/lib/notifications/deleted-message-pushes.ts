import { isRecord, records, str } from "../more/narrow";
import { chatChannelIdFrom } from "./targets";
import type { PresentedNotification } from "./push-types";

/**
 * Which chat pushes in the tray quote a message that has since been deleted
 * (#4470, `spec/behavior/chat/README.md` § Edit and delete). Since #4418 a
 * delete removes every recipient's in-app row for the message; these readers
 * let the phone take the matching push out of the tray too. Every match is by
 * the push's own message, never by its channel.
 *
 * Pure, so the tray calls in `push.ts` stay thin.
 */

/**
 * The message a single-message chat push quotes (`data.messageId`, beside
 * `notificationId`; § Deep Linking), or `null`. A bundle quotes no one
 * message and carries none.
 */
export function chatPushMessageId(data: unknown): string | null {
  if (chatChannelIdFrom(data) === null || !isRecord(data)) return null;
  if (data.bundled === true) return null;
  return str(data, "messageId");
}

/** The tray entries whose push quotes one of `messageIds`. */
export function pushesQuotingMessages(
  presented: readonly PresentedNotification[],
  messageIds: ReadonlySet<string>,
): string[] {
  if (messageIds.size === 0) return [];
  return presented
    .filter((n) => {
      const id = chatPushMessageId(n.request.content.data);
      return id !== null && messageIds.has(id);
    })
    .map((n) => n.request.identifier);
}

/**
 * The page of `GET /v1/notifications` the phone holds, as far as it can say
 * which rows are gone.
 */
export interface NotificationPageSnapshot {
  /** The page's rows (raw `notifications` objects). */
  rows: unknown;
  /** The page size asked for: a page that came back full may have more. */
  limit: number;
  /** When the page was read (TanStack `dataUpdatedAt`, epoch ms). */
  readAt: number;
}

/**
 * How long before the page was read a push must have arrived to be judged
 * against it. Its row is written before the push is sent, so a push older than
 * this was certainly written before the server read the page, network time
 * included.
 */
export const PAGE_READ_MARGIN_MS = 30_000;

/**
 * How far after the page's oldest row a push must have arrived to be judged
 * against a full page. A push arrives after its row is written, sometimes much
 * later (a phone that was off); this margin keeps a push whose row has merely
 * paged out from reading as deleted. A miss the other way only leaves a push
 * in the tray, as before #4470.
 */
export const FULL_PAGE_MARGIN_MS = 60 * 60_000;

/** `date` is epoch ms; a seconds value (older iOS builds) is scaled up. */
function deliveredAtMs(date: number): number {
  return date < 1e12 ? date * 1000 : date;
}

/**
 * The tray entries whose in-app row the page shows is gone: a single-message
 * chat push for a channel of the active chapter (`chapterChannelIds`), which
 * the page should hold and doesn't. Its row was deleted with its message
 * (#4418), or the member cleared it; either way the push has nothing left to
 * open. Covers a delete made while the app was closed, which no Realtime
 * frame reported.
 *
 * Errs toward leaving a push: another chapter's push (the page is per
 * chapter), a bundle, one that arrived around or after the read, and one that
 * may sit past a full page's end are all left alone.
 */
export function pushesWithDeletedRows(
  presented: readonly PresentedNotification[],
  page: NotificationPageSnapshot,
  chapterChannelIds: ReadonlySet<string>,
): string[] {
  const rows = records(page.rows);
  const rowIds = new Set(
    rows.map((row) => str(row, "id")).filter((id): id is string => !!id),
  );
  let oldestAt = Infinity;
  for (const row of rows) {
    const at = Date.parse(str(row, "created_at") ?? "");
    if (Number.isFinite(at)) oldestAt = Math.min(oldestAt, at);
  }
  const full = rows.length >= page.limit;
  if (full && !Number.isFinite(oldestAt)) return [];

  return presented
    .filter((n) => {
      const data = n.request.content.data;
      const channelId = chatChannelIdFrom(data);
      if (channelId === null || !chapterChannelIds.has(channelId)) {
        return false;
      }
      if (chatPushMessageId(data) === null || !isRecord(data)) return false;
      const rowId = str(data, "notificationId");
      if (rowId === null || rowIds.has(rowId)) return false;
      const at = deliveredAtMs(n.date);
      if (at > page.readAt - PAGE_READ_MARGIN_MS) return false;
      if (full && at < oldestAt + FULL_PAGE_MARGIN_MS) return false;
      return true;
    })
    .map((n) => n.request.identifier);
}
