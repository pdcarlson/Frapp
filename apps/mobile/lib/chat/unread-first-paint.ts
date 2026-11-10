/**
 * What the unread marks show before `GET /v1/channels/unread` answers (#4006).
 *
 * The counts are the server's (`spec/behavior/chat/README.md` § Read
 * Receipts), and on open or resume that read is one of several requests sent
 * at once, each taking seconds (#3728). Until it lands the phone showed
 * nothing on a cold start (the query cache is memory only) and the counts from
 * before it was backgrounded on a resume, although the push for the new
 * message had already reached it. Two things the phone already has fill that
 * gap:
 *
 * - **The last server answer**, kept in AsyncStorage per member and chapter
 *   (`unread-memory.ts`), stands in while the query has no data.
 * - **Chat pushes still in the tray**, read at launch and each time the app
 *   returns from the background, light their channels. A push names its
 *   channel and nothing else (no message id, no mention flag), so a channel
 *   that reads as fully read becomes "one unread" and no mention is claimed.
 *   A channel with a count keeps it.
 *
 * ## An overlay, never a cache write
 *
 * Neither goes into the query cache. `useShownUnreadCounts` lays them over
 * `useChannelUnreadCounts` for the three readers that draw the counts (chat
 * home, Messages, the app badge), so they agree, and the cache entry stays
 * what it was: the server's last answer, its age, and its error. That is what
 * keeps the rest honest:
 *
 * - **The server's answer wins.** The saved answer shows only while the query
 *   has no data, and the tray lights only until the query is answered after
 *   that tray read began. A push can still be in the tray for a channel read
 *   on another device (the tray is cleared after the answer), and lighting it
 *   then would undo the answer.
 * - **A failed read still reads as failed.** With an error the overlay is off
 *   and the screen says the counts are unavailable.
 * - **Unread only never filters on a saved answer.** `provisional` tells chat
 *   home the counts are the phone's, and it filters nothing until they are
 *   the server's (`sidebarUnreadCounts` gives the reason).
 * - **The tray is cleared on server answers only.** `use-badge-sync.ts` reads
 *   the query itself for that, so a saved answer that counts a channel as
 *   read can't dismiss the push that just arrived for it.
 * - **Only a server answer is saved** for the next launch.
 *
 * This file is the overlay and its readers. What fills it is
 * `useUnreadFirstPaintRuntime` (`use-unread-first-paint-runtime.ts`), mounted
 * once from `components/app-runtime.tsx` and kept apart because it reads the
 * auth session, which a screen's spec can't load.
 */
import { useMemo, useSyncExternalStore } from "react";
import { useChannelUnreadCounts, type ChannelUnreadCount } from "@repo/hooks";

/** What the phone holds to show ahead of the server. */
export interface UnreadFirstPaint {
  /** The last saved answer for the signed-in member and chapter. */
  saved: ChannelUnreadCount[] | null;
  /** The tray's chat channels, and when that read of the tray began. */
  tray: { channelIds: ReadonlySet<string>; since: number } | null;
}

const NOTHING: UnreadFirstPaint = { saved: null, tray: null };
let held: UnreadFirstPaint = NOTHING;
const listeners = new Set<() => void>();

/** Sets what the phone holds. Only the runtime calls it. */
export function holdUnreadFirstPaint(next: Partial<UnreadFirstPaint>): void {
  held = { ...held, ...next };
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: a fresh process. */
export function resetUnreadFirstPaintForTests(): void {
  holdUnreadFirstPaint(NOTHING);
}

/**
 * `rows` with every channel in `channelIds` shown as at least one unread: a
 * fully read row becomes one, and a channel with no row (a first DM, a new
 * channel, no rows at all yet) gets one. The same array when nothing changes.
 */
export function lightChannels(
  rows: ChannelUnreadCount[],
  channelIds: ReadonlySet<string>,
): ChannelUnreadCount[] {
  const missing = new Set(channelIds);
  let changed = false;
  const next = rows.map((row) => {
    missing.delete(row.channel_id);
    if (row.unread_count > 0 || !channelIds.has(row.channel_id)) return row;
    changed = true;
    return { ...row, unread_count: 1 };
  });
  if (missing.size === 0) return changed ? next : rows;
  for (const channel_id of missing) {
    next.push({ channel_id, unread_count: 1, mention_count: 0 });
  }
  return next;
}

export interface ShownUnreadCounts {
  data: ChannelUnreadCount[] | undefined;
  isError: boolean;
  /**
   * The counts aren't a server answer: they are the saved one, or only what
   * the tray names. Good enough to mark a row, not to filter rows out.
   */
  provisional: boolean;
}

/** The counts to draw: the query's, with what the phone holds laid over. */
export function shownUnreadCounts(
  query: {
    data: ChannelUnreadCount[] | undefined;
    isError: boolean;
    dataUpdatedAt: number;
  },
  first: UnreadFirstPaint,
): ShownUnreadCounts {
  if (query.isError) {
    return { data: query.data, isError: true, provisional: false };
  }
  const answered = query.data !== undefined;
  const base = query.data ?? first.saved ?? undefined;
  // Lit until an answer strictly later than the tray read: an answer from
  // before the app came forward is the stale one the tray is there to correct.
  const lit =
    first.tray && query.dataUpdatedAt <= first.tray.since
      ? first.tray.channelIds
      : null;
  const data = lit && lit.size > 0 ? lightChannels(base ?? [], lit) : base;
  return { data, isError: false, provisional: !answered && data !== undefined };
}

/**
 * `useChannelUnreadCounts`, as the screens should draw it. `query` is the
 * query itself, for a pull-to-refresh and for anything that must act on the
 * server's answer alone.
 */
export function useShownUnreadCounts(options?: { enabled?: boolean }) {
  const query = useChannelUnreadCounts(options);
  const first = useSyncExternalStore(
    subscribe,
    () => held,
    () => NOTHING,
  );
  const { data, isError, dataUpdatedAt } = query;
  const shown = useMemo(
    () => shownUnreadCounts({ data, isError, dataUpdatedAt }, first),
    [data, isError, dataUpdatedAt, first],
  );
  return { ...shown, query };
}
