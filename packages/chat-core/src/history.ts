/**
 * Paging through a channel's history: the newest page a thread opens on, and
 * older pages as the member scrolls back (#1571 web, #2772 mobile).
 *
 * Both clients read through here, so the cursor, the merge and the end of
 * history are decided once, and so is the bookkeeping around them
 * (`createHistoryPager`): which read is in flight, whether the last one
 * failed, and where each channel's history starts. A hook only subscribes.
 *
 * Every read lands in the one channel cache the realtime merge, the outbox
 * and the reconnect backfill write to (`chatMessagesKey`), through the
 * id-keyed merges in `./cache`, so a row that arrives by more than one path is
 * one message.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createFrappClient } from "@repo/api-sdk";
import {
  cacheFromPage,
  mergeUnheldRows,
  oldestConfirmed,
  reconcileNewestPage,
} from "./cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";

type FrappClient = ReturnType<typeof createFrappClient>;

/** The newest page a channel opens on. */
export const FIRST_PAGE_LIMIT = 50;
/** Each older page. Under the API's 200 cap, and small enough that the
 *  reaction read's `in (…)` list of ids stays a reasonable URL. */
export const OLDER_PAGE_LIMIT = 100;

/**
 * What one older-page read did.
 *
 * - `loaded`: older rows were added.
 * - `start`: the channel has nothing older.
 * - `stale`: the cache's oldest row moved while the page was in flight (a
 *   refetch dropped the older pages), so the page was discarded rather than
 *   merged across a hole. Nothing is wrong; ask again.
 * - `error`: the read failed.
 */
export type LoadOlderResult = "loaded" | "start" | "stale" | "error";

export interface HistoryPageQuery {
  limit: number;
  /** ISO timestamp; the API returns rows strictly before it. */
  before?: string;
  /** Message id; the API returns rows created after it. */
  since?: string;
}

/** One page of rows plus their reaction and card-action rows. */
export interface HistoryPage {
  rows: RawChatMessage[];
  actions: RawChatMessageAction[];
}

export type FetchHistoryPage = (
  channelId: string,
  query: HistoryPageQuery,
) => Promise<HistoryPage>;

/**
 * The one way a client reads a page: `GET /v1/channels/{id}/messages`, then a
 * single batched select on `chat_message_actions`, so reactions and poll
 * tallies are on the first paint rather than appearing only after a live
 * echo. Rejects when either read fails.
 *
 * The action read is not best-effort. A page merged without its actions stays
 * that way: `mergeUnheldRows` never re-merges a row it holds, and Realtime
 * delivers only new action rows, so a poll read with no votes would show a
 * partial tally for as long as the thread is cached. A failed page instead
 * shows Retry (older pages) or goes through the query's retry (the newest).
 *
 * `supabase` may be `null` where a client can boot without one (mobile's
 * `getSupabaseClient`); the page then carries no actions.
 */
export function createHistoryPageFetcher(
  apiClient: FrappClient,
  supabase: SupabaseClient | null,
): FetchHistoryPage {
  return async (channelId, query) => {
    const { data, error } = await apiClient.GET("/v1/channels/{id}/messages", {
      params: { path: { id: channelId }, query },
    });
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as RawChatMessage[]) : [];
    const messageIds = rows.map((row) => row.id).filter(Boolean);
    if (!supabase || messageIds.length === 0) return { rows, actions: [] };
    const { data: actions, error: actionsError } = await supabase
      .from("chat_message_actions")
      .select("*")
      .in("message_id", messageIds);
    if (actionsError) throw actionsError;
    return { rows, actions: (actions ?? []) as RawChatMessageAction[] };
  };
}

/**
 * Where a read left the channel's history. `start` is set only once a read
 * came back short: the id of the channel's first row, or `null` for a channel
 * with no confirmed rows at all. A client says "nothing older" only while the
 * cache's oldest row is still that row, so a refetch that drops the older
 * pages makes the rest of the history reachable again (`hasOlderHistory`).
 */
export interface HistoryEdge {
  start?: string | null;
}

/**
 * The newest page, folded into the cache as it stands when the read lands
 * rather than replacing it: see `reconcileNewestPage` for what that keeps
 * (optimistic rows, Realtime arrivals) and what it drops (older pages it did
 * not re-read). The caller returns `cache` from its query function.
 */
export async function readNewestPage(
  queryClient: QueryClient,
  channelId: string,
  fetchPage: FetchHistoryPage,
): Promise<HistoryEdge & { cache: ChannelCache }> {
  const { rows, actions } = await fetchPage(channelId, {
    limit: FIRST_PAGE_LIMIT,
  });
  // Read after the await, so it is the cache as it is now: an outbox hydrate
  // or a Realtime row that landed during the read is in it (#2486).
  const cache = reconcileNewestPage(
    queryClient.getQueryData<ChannelCache>(chatMessagesKey(channelId)),
    cacheFromPage(rows, actions),
  );
  if (rows.length < FIRST_PAGE_LIMIT) {
    return { cache, start: oldestConfirmed(cache)?.id ?? null };
  }
  return { cache };
}

/**
 * One page of older history, merged into the live cache.
 *
 * The cursor is the oldest confirmed row's `created_at` plus one millisecond,
 * not the timestamp itself: the API's `before` is strict, so two rows sharing
 * the boundary instant (an imported burst, a bot) would leave the one the
 * last page cut off unreachable forever. The overlap this causes is deduped
 * by id (`mergeUnheldRows`), so no row is merged twice and none moves. A full
 * page that adds nothing means more than a page of rows share that
 * millisecond, and only then does it fall back to the strict cursor.
 *
 * The page merges only onto the edge it was read from. A refetch that dropped
 * the older pages meanwhile moved it, and merging there would draw a hole as
 * if nothing had been said in it; that read is `stale`.
 *
 * Rejects when a read fails; the caller owns how that is shown.
 */
export async function readOlderPage(
  queryClient: QueryClient,
  channelId: string,
  fetchPage: FetchHistoryPage,
): Promise<HistoryEdge & { outcome: Exclude<LoadOlderResult, "error"> }> {
  const key = chatMessagesKey(channelId);
  const edge = oldestConfirmed(queryClient.getQueryData<ChannelCache>(key));
  if (!edge) return { outcome: "start", start: null };
  const cursors = [
    new Date(Date.parse(edge.created_at) + 1).toISOString(),
    edge.created_at,
  ];
  for (const before of cursors) {
    const { rows, actions } = await fetchPage(channelId, {
      limit: OLDER_PAGE_LIMIT,
      before,
    });
    // Assigned inside the updater, which runs synchronously; boxed so the
    // compiler does not narrow it to its initial value.
    const result: { outcome: Exclude<LoadOlderResult, "error"> } = {
      outcome: "stale",
    };
    queryClient.setQueryData<ChannelCache>(key, (current) => {
      if (!current || oldestConfirmed(current)?.id !== edge.id) {
        return current;
      }
      const merged = mergeUnheldRows(current, rows, actions);
      result.outcome = merged.added > 0 ? "loaded" : "start";
      return merged.cache;
    });
    const { outcome } = result;
    const short = rows.length < OLDER_PAGE_LIMIT;
    if (outcome === "stale" || (outcome === "loaded" && !short)) {
      return { outcome };
    }
    if (short) {
      return {
        outcome,
        start:
          oldestConfirmed(queryClient.getQueryData<ChannelCache>(key))?.id ??
          null,
      };
    }
    // A full page that added nothing: retry on the strict cursor.
  }
  return { outcome: "stale" };
}

/**
 * Whether older history may exist beyond what `cache` holds, given the start
 * a read last recorded for the channel (`HistoryEdge.start`, `undefined` when
 * none has). "Maybe" until a read came back short, and again once the cache's
 * oldest row is no longer the start it found.
 */
export function hasOlderHistory(
  cache: ChannelCache | undefined,
  recordedStart: string | null | undefined,
): boolean {
  if (cache === undefined) return false;
  if (recordedStart === undefined) return true;
  return (oldestConfirmed(cache)?.id ?? null) !== recordedStart;
}

/** What a pager knows per channel. Replaced, never mutated, on each change. */
export interface HistoryPagerState {
  /** The start a short read recorded per channel (`HistoryEdge.start`). */
  starts: ReadonlyMap<string, string | null>;
  /** Per channel: an older-page read in flight, or the last one failed. */
  older: ReadonlyMap<string, "loading" | "error">;
}

export interface HistoryPager {
  /** The newest page, for a channel query's `queryFn` (`readNewestPage`). */
  readNewest: (channelId: string) => Promise<ChannelCache>;
  /**
   * The next page of older history (`readOlderPage`). Concurrent calls for
   * one channel share one read. Resolves what it did; `error` stays in
   * `older` until the next attempt.
   */
  loadOlder: (channelId: string) => Promise<LoadOlderResult>;
  /** For `useSyncExternalStore`. */
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => HistoryPagerState;
}

/**
 * The bookkeeping around paging that both clients' hooks share: the start
 * each channel's history was found at, one read per channel at a time, and
 * each channel's older-page status.
 *
 * Per channel, not per hook: one hook serves every channel a screen switches
 * through, and a read that settles after a switch must only ever write its
 * own channel's status, never the one now on screen. Framework-free, so
 * chat-core takes no React dependency; a hook reads it through
 * `useSyncExternalStore`.
 */
export function createHistoryPager(
  queryClient: QueryClient,
  fetchPage: FetchHistoryPage,
): HistoryPager {
  let state: HistoryPagerState = { starts: new Map(), older: new Map() };
  const listeners = new Set<() => void>();
  const inFlight = new Map<string, Promise<LoadOlderResult>>();

  const update = (next: HistoryPagerState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const recordStart = (channelId: string, start: string | null | undefined) => {
    if (start === undefined) return;
    if (state.starts.has(channelId) && state.starts.get(channelId) === start) {
      return;
    }
    const starts = new Map(state.starts);
    starts.set(channelId, start);
    update({ ...state, starts });
  };
  const setOlder = (channelId: string, status: "loading" | "error" | null) => {
    if ((state.older.get(channelId) ?? null) === status) return;
    const older = new Map(state.older);
    if (status === null) older.delete(channelId);
    else older.set(channelId, status);
    update({ ...state, older });
  };

  return {
    readNewest: async (channelId) => {
      const newest = await readNewestPage(queryClient, channelId, fetchPage);
      recordStart(channelId, newest.start);
      return newest.cache;
    },
    loadOlder: (channelId) => {
      const pending = inFlight.get(channelId);
      if (pending) return pending;
      const run = async (): Promise<LoadOlderResult> => {
        setOlder(channelId, "loading");
        try {
          const { outcome, start } = await readOlderPage(
            queryClient,
            channelId,
            fetchPage,
          );
          recordStart(channelId, start);
          setOlder(channelId, null);
          return outcome;
        } catch {
          setOlder(channelId, "error");
          return "error";
        }
      };
      const promise = run().finally(() => {
        inFlight.delete(channelId);
      });
      inFlight.set(channelId, promise);
      return promise;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
  };
}
