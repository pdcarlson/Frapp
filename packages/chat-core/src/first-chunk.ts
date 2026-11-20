/**
 * What both clients keep of chat between loads so a cold start paints before
 * the network answers: web's first chunk (`apps/web/lib/chat/first-chunk-cache.ts`)
 * and the phone's first-paint copy (`apps/mobile/lib/launch/first-paint-cache.ts`,
 * #5768). The storage differs (IndexedDB, AsyncStorage); the limits, the
 * encoding a tail is written in, which rows a tail keeps, and how a kept copy
 * is seeded into the query cache are one definition here, so a change to any
 * of them reaches both. The comments below were written for web's cache, the
 * first of the two, and hold for both.
 */

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  toRawRow,
  type ChannelCache,
  type ChatMessage,
  type RawChatMessage,
} from "./types";

/**
 * How many messages a tail holds. `1s` says "last ~30 messages"; the live
 * backfill asks for 50 and the extra 20 buy a cache row nobody sees — the
 * window a cold load paints is shorter than either number.
 */
export const FIRST_CHUNK_MESSAGE_LIMIT = 30;

/**
 * How many channels keep a tail per scope.
 *
 * One would be enough if the channel a cold load lands on were always the one
 * the member last read — it is not. `chat-shell.tsx` resolves the active
 * channel from `?channel=`, then this browser's last channel, then the
 * chapter default, then `#general`, then the first row, so another tab, a
 * deleted channel or a deep link can each send a load somewhere other than the
 * last tail written. Keeping the few most
 * recent tails means the cache is warm for whichever of those the shell picks;
 * eviction pins the landing channel on top (`evictOldestTails`).
 */
export const FIRST_CHUNK_CHANNEL_LIMIT = 3;

/**
 * How old a row may be and still paint.
 *
 * The reconciling fetch makes any age *correct* eventually, so this is not
 * about staleness — it is about what a member sees for the few hundred
 * milliseconds before it lands. A week-old timeline painting as real is a lie
 * worth avoiding, and an abandoned profile stops holding chat content on disk
 * indefinitely.
 */
export const FIRST_CHUNK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The encoding a tail's rows are written in. `readFirstChunk` serves only a
 * tail stamped with this value, and nothing else is ever upgraded in place.
 *
 * `2` is the encoding in which `sender_blocked` means what the block list
 * needs it to (#2313). Before #2493, `toRawRow` wrote the flag on **every**
 * row, Realtime echoes included, so an unmarked tail rehydrates echo rows with
 * `sender_blocked: false`, and `normalizeRow` then reads them as rows the
 * server evaluated and cleared. The web timeline shows a server-cleared row
 * even while the block list is unavailable, which is the one place that claim
 * is load-bearing, so a pre-#2493 tail would paint a blocked member's echoed
 * message on any cold load until the list read lands, and for a whole session
 * with the list unreadable. Refusing the tail costs a cold load of that channel
 * (see the header for a tab still on the old bundle).
 *
 * **What the marker does not close.** A REST row's cleared verdict is kept on
 * purpose, so a warm load paints other members' cached rows at once (the rank-1
 * "render real" clause, `spec/ui/resilience/performance-budgets.md`). That
 * verdict is only as old as the REST read that produced it, not the tail write:
 * `toRawRow` carries it through every rewrite, and each Realtime merge
 * rewrites the tail, so it can outlive a block made after that read, and the
 * week `FIRST_CHUNK_MAX_AGE_MS` allows. The persisted block-list floor
 * ({@link CachedBlockFloor}) is what hides such a row on a cold load, for any
 * block a ready read here has seen.
 *
 * Bump it whenever the meaning of a persisted row changes.
 */
export const TAIL_ROW_FORMAT = 2;

export function seedQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
  data: unknown,
  cachedAt: number,
): void {
  /*
    `updatedAt` is the row's own origin time, not now.

    Two things follow from it. The persist path writes `dataUpdatedAt` back as
    `cachedAt`, so re-seeding a row preserves its age instead of renewing it —
    without this, a cache read would refresh the very rows it just read and
    `FIRST_CHUNK_MAX_AGE_MS` could never expire anything. And the seeded query
    is born as old as the data really is, which is what any staleness rule
    downstream should be reasoning about.
  */
  queryClient.setQueryData(queryKey, data, { updatedAt: cachedAt });
  /*
    `cancelRefetch: false` — without it this seed makes the reconcile *slower*.

    `invalidateQueries` forwards to `refetchQueries`, which defaults
    `cancelRefetch` to `true`, and `Query.fetch` reads that as "abort the
    in-flight request and start a new one" whenever `state.data` is defined —
    which the `setQueryData` above has just made true. So the `GET` already
    half-way to the server would be cancelled and reissued from zero, and the
    authoritative list would land later than it would have with no cache at
    all, having cost the server two requests. Passing `false` keeps the
    in-flight fetch and simply marks the query for one if none is running.

    `refetchType: "active"` (the default), not `"all"`. A seeded tail is a
    query `setQueryData` just created, and until a `useQuery` mounts on it
    the query has no `queryFn`: refetching it rejects with
    `Missing queryFn: '<hash>'`, which the query-error reporter sends to
    Sentry (FRAPP-WEB-3, #3905). Every cached channel the member is not
    looking at is such a query. The invalidation alone is what this needs:
    it marks the seed stale, so the observer that mounts on it later
    refetches on mount, and one already mounted refetches now.
  */
  void queryClient.invalidateQueries(
    { queryKey, exact: true },
    // Second argument, not the first: `cancelRefetch` is an *option*, and
    // `invalidateQueries` ignores it inside the filters object, where it reads
    // as a silently-accepted no-op.
    { cancelRefetch: false },
  );
}

/**
 * Whether a real fetch has already populated this channel's message cache.
 *
 * Not `getQueryData(key) !== undefined`, which is what this used to ask and
 * which the **outbox** defeats: `useChatChannel`'s mount effect runs
 * `hydrateOutboxIntoCache`, and that does a `setQueryData` of
 * `emptyCache()` plus the member's queued rows the moment a channel id exists.
 * Mere presence therefore means "somebody wrote here", not "the server
 * answered" — and the member it misfires for is the one with unsent messages,
 * who is precisely the member this cache exists to serve. They would have got
 * their own pending row over a skeleton and nothing else.
 *
 * A confirmed row is the honest signal: only `mergeServerRows` produces one,
 * and only a backfill, a realtime echo or this seed calls it.
 */
export function hasServerRows(cache: ChannelCache | undefined): boolean {
  if (!cache) return false;
  return Object.values(cache.byId).some(
    (message) => message._status === "confirmed",
  );
}

/**
 * The confirmed tail of a timeline, in the wire shape, newest {@link
 * FIRST_CHUNK_MESSAGE_LIMIT} rows.
 *
 * Only `confirmed` rows survive the filter. Every other `_status` is the
 * outbox's to replay (`pending`, `failed`) or a locally persisted notice's
 * (`unconfirmed`, `recorded`, `heavy-command-notices.ts`), and both of those
 * sources run on top of whatever this seeds — so a copy here would be a
 * second, staler writer for a row somebody else owns.
 *
 * Exported for the spec, which asserts the round trip through
 * `normalizeRow` rather than trusting this list of fields to stay in step.
 */
export function toCacheableRows(messages: ChatMessage[]): RawChatMessage[] {
  return messages
    .filter((message) => message._status === "confirmed")
    .slice(-FIRST_CHUNK_MESSAGE_LIMIT)
    .map(toRawRow);
}

/** The parts of the block list's state the floor is weighed against. */
export interface BlockListForFloor {
  ids: ReadonlySet<string>;
  unblocked: ReadonlySet<string>;
  /** When the live list was last read, `0` if not since the cache was cleared. */
  readAt: number;
}

/**
 * The ids a thread is classified against: the live list's, plus the kept
 * floor until the live list has been read this session (#2688).
 *
 * Kept tails keep each row's server verdict, and the classifier shows a
 * server-cleared row in every list state unless its sender is on `ids`, so a
 * cold load needs the floor before the list lands, or a member blocked since
 * the tail's read paints. Once a read has succeeded, the live ids (which
 * TanStack keeps through a failed refetch) are newer than anything on disk,
 * and a floor still applied then would turn rows the ready read had shown back
 * into tombstones. A member this client confirmed unblocking is taken off the
 * floor, as a confirmed change applies in every list state.
 */
export function blockIdsWithFloor(
  blockList: BlockListForFloor,
  floor: ReadonlySet<string> | null,
): ReadonlySet<string> {
  if (floor === null || floor.size === 0 || blockList.readAt !== 0) {
    return blockList.ids;
  }
  const ids = new Set(blockList.ids);
  for (const id of floor) {
    if (!blockList.unblocked.has(id)) ids.add(id);
  }
  return ids;
}
