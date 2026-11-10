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
 * - **The last server answer**, kept in AsyncStorage per member and chapter,
 *   seeds the cache on a cold start.
 * - **Chat pushes still in the tray** light their channels, on a cold start
 *   and each time the app returns from the background. A push names its
 *   channel and nothing else (no message id, no mention flag), so a channel
 *   the cache counts as read becomes "one unread" and no mention is claimed.
 *   A channel with a count keeps it.
 *
 * Both are written into the query's own cache entry, so chat home, Messages
 * and the app badge (`use-badge-sync.ts`) show the same thing.
 *
 * ## The server's answer always wins
 *
 * - The seed is written with `updatedAt: 0` and a lit row keeps the entry's
 *   timestamp, so neither makes the entry fresh: the read on mount, on focus
 *   and on resume still goes out, and its result replaces the entry whole.
 * - Nothing is written once the server has answered since the launch or the
 *   foreground that asked for it. A push can still be in the tray then for a
 *   channel read on another device (the tray is cleared after the answer), and
 *   lighting it would undo the answer.
 * - Only a server answer is saved for the next launch, never a seed, a lit row
 *   or another optimistic write.
 * - `use-badge-sync.ts` clears the tray only on a settled answer, so a seed
 *   that counts a channel as read can't dismiss the push that just arrived
 *   for it.
 *
 * Mounted once from `components/app-runtime.tsx`.
 */
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  hashKey,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  CHANNEL_UNREAD_COUNTS_KEY,
  viewedChannelId,
  type ChannelUnreadCount,
} from "@repo/hooks";
import { useAuthSession } from "@/lib/auth-session";
import { presentedChatChannelIds } from "@/lib/notifications/push";

/**
 * Where the last server answer is kept. Scoped like the last channel
 * (`lastChannelStorageKey`): by the auth uid, which is known as soon as the
 * session is restored (`users.id` waits on `/v1/users/me`, one of the slow
 * requests), and by chapter, with a stable name for a token that carries none.
 */
export function unreadMemoryKey(
  userId: string,
  chapterId: string | null,
): string {
  return `frapp.chat.unread.${userId}.${chapterId ?? "sole"}`;
}

function isUnreadRow(value: unknown): value is ChannelUnreadCount {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.channel_id === "string" &&
    typeof row.unread_count === "number" &&
    typeof row.mention_count === "number"
  );
}

/** A saved answer, or `null` for anything that isn't one. */
export function parseUnreadMemory(
  raw: string | null,
): ChannelUnreadCount[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isUnreadRow) ? parsed : null;
  } catch {
    return null;
  }
}

async function readUnreadMemory(
  key: string,
): Promise<ChannelUnreadCount[] | null> {
  try {
    return parseUnreadMemory(await AsyncStorage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * `rows` with every channel in `channelIds` that reads as fully read counted
 * as one unread. The same array when nothing changes.
 */
export function lightChannels(
  rows: ChannelUnreadCount[],
  channelIds: ReadonlySet<string>,
): ChannelUnreadCount[] {
  let changed = false;
  const next = rows.map((row) => {
    if (row.unread_count > 0 || !channelIds.has(row.channel_id)) return row;
    changed = true;
    return { ...row, unread_count: 1 };
  });
  return changed ? next : rows;
}

/**
 * The tray's chat channels, less the thread on screen: the resume resync
 * stamps that one read (`createChatActivityHandler`), so it must not light.
 */
async function trayChannelIds(): Promise<Set<string>> {
  const ids = await presentedChatChannelIds();
  const viewed = AppState.currentState === "active" ? viewedChannelId() : null;
  if (viewed) ids.delete(viewed);
  return ids;
}

/**
 * Lights the tray's channels in the cached counts, unless the server has
 * answered since `since` (the launch or foreground this belongs to) or there
 * are no counts to light.
 */
function lightFromTray(
  queryClient: QueryClient,
  channelIds: ReadonlySet<string>,
  since: number,
): void {
  const state = queryClient.getQueryState<ChannelUnreadCount[]>(
    CHANNEL_UNREAD_COUNTS_KEY,
  );
  if (!state?.data || state.dataUpdatedAt > since) return;
  const next = lightChannels(state.data, channelIds);
  if (next === state.data) return;
  queryClient.setQueryData(CHANNEL_UNREAD_COUNTS_KEY, next, {
    updatedAt: state.dataUpdatedAt,
  });
}

const UNREAD_QUERY_HASH = hashKey(CHANNEL_UNREAD_COUNTS_KEY);

export function useUnreadFirstPaintRuntime(): void {
  const queryClient = useQueryClient();
  const { status, userId, chapterId, isChapterResolving } = useAuthSession();
  // No key until the chapter claim has been read: before that `null` means
  // "not known yet", and the seed would come from the wrong chapter's slot.
  const memoryKey =
    status === "authenticated" && userId && !isChapterResolving
      ? unreadMemoryKey(userId, chapterId)
      : null;

  // Cold start, and any later change of member or chapter (which clears the
  // cache): seed from the last answer, with the tray's channels already lit so
  // the first paint is the only one before the server's.
  useEffect(() => {
    if (!memoryKey) return;
    let cancelled = false;
    const since = Date.now();
    void Promise.all([readUnreadMemory(memoryKey), trayChannelIds()]).then(
      ([memory, channelIds]) => {
        if (cancelled) return;
        const state = queryClient.getQueryState(CHANNEL_UNREAD_COUNTS_KEY);
        if (state?.data !== undefined) {
          lightFromTray(queryClient, channelIds, since);
          return;
        }
        // A read that already failed keeps its error on screen; a seed would
        // replace "couldn't load" with counts nobody just read.
        if (!memory || state?.status === "error") return;
        queryClient.setQueryData(
          CHANNEL_UNREAD_COUNTS_KEY,
          lightChannels(memory, channelIds),
          { updatedAt: 0 },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [queryClient, memoryKey]);

  // Each return from the background. `background`, not `inactive`, the line
  // `useChatRealtimeBinding` draws for its resume.
  useEffect(() => {
    if (!memoryKey) return;
    let previous: AppStateStatus | null = AppState.currentState;
    let cancelled = false;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous === "background") {
        const since = Date.now();
        void trayChannelIds().then((channelIds) => {
          if (!cancelled) lightFromTray(queryClient, channelIds, since);
        });
      }
      previous = next;
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [queryClient, memoryKey]);

  // Keep the server's latest answer for the next launch.
  useEffect(() => {
    if (!memoryKey) return;
    let lastSaved: string | null = null;
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type !== "updated" ||
        event.action.type !== "success" ||
        event.action.manual ||
        event.query.queryHash !== UNREAD_QUERY_HASH
      ) {
        return;
      }
      const serialized = JSON.stringify(event.query.state.data ?? null);
      if (serialized === lastSaved || parseUnreadMemory(serialized) === null) {
        return;
      }
      lastSaved = serialized;
      AsyncStorage.setItem(memoryKey, serialized).catch(() => {
        /* Best-effort: the next launch starts with no marks, as before. */
      });
    });
  }, [queryClient, memoryKey]);
}
