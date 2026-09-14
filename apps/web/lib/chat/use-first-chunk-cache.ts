"use client";

/**
 * React glue for the first-chunk read cache (`first-chunk-cache.ts`): who owns
 * the scope, when a cold load seeds from disk, and when the disk is written.
 *
 * ## Seeding is a seed, not a source of truth
 *
 * `seedQuery` writes into the `QueryClient` only where nothing is there yet,
 * and immediately invalidates what it wrote. Both halves are load-bearing:
 *
 * - **Only where empty** — a fetch that has already resolved outranks anything
 *   on disk. Without the guard, an IndexedDB read that lost the race to a fast
 *   network would overwrite fresh rows with stale ones, which is the one thing
 *   a first-paint cache must never do.
 * - **Invalidate after** — `["chat", id, "messages"]` is `staleTime: Infinity`
 *   and `["channels"]` is 60s, so seeding data would otherwise *suppress* the
 *   reconciling fetch: the cache would paint and nothing would ever correct it.
 *   `invalidateQueries` overrides staleness, so the timeline paints from disk
 *   and refetches underneath it — cached first, live wins.
 *
 * `1s` lists "refetch-on-mount for channels when a cached list exists" under
 * *delete*. That clause is about deleting a **gate** — the cold load must not
 * wait on the round trip — and it does not: the rail is up and readable while
 * the refetch is in flight. Dropping the reconcile itself would leave a member
 * who was added to a channel on another device unable to see it until their
 * next hard reload, which no clause asks for.
 *
 * ## Writing is gated on the scope being older than the data
 *
 * `dropCacheWhenIdentityChanges` in `lib/providers/frapp-client-provider.tsx`
 * clears the `QueryClient` from an effect on an **ancestor** of this tree, and
 * React flushes child effects before parent ones. So on the commit that
 * publishes a new chapter or auth uid there is exactly one pass where a hook in
 * here sees the *new* scope next to the *outgoing* scope's rows — and writing
 * then would file one tenant's channel list under another's key, which is the
 * cross-tenant leak this whole design exists to make impossible.
 *
 * `canPersist` closes it without needing to know about that ordering: a row is
 * written only when the data in hand was fetched at or after the moment the
 * current scope became current. Stale rows carry an older `dataUpdatedAt` by
 * seconds, so they are refused; the refetch that follows the clear carries a
 * newer one and is written. It fails closed — a skipped write costs one cold
 * load — and it needs no ref mutated during render, so it stays correct under
 * StrictMode's double-invoked effects.
 */

import { useCallback, useEffect, useRef } from "react";
import { useChatScope } from "./chat-scope";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useChannels } from "@repo/hooks";
import { emptyCache, mergeServerRows } from "@repo/chat-core/cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
} from "@repo/chat-core/types";
import { asArray } from "@/lib/utils";
import type { ChatChannel } from "@/components/chat/channel-list";
import {
  pruneForeignScopes,
  readFirstChunk,
  writeChannelList,
  writeChannelTail,
  type FirstChunk,
  type FirstChunkScope,
} from "./first-chunk-cache";

/**
 * How a busy timeline's tail is rewritten.
 *
 * `debounceMs` is the settle window: every realtime merge is a `setQueryData`
 * and bumps `dataUpdatedAt`, so without it a lively channel would rewrite the
 * same thirty rows once per arriving message.
 *
 * `maxWaitMs` is why this is not a plain trailing debounce. Messages arriving
 * faster than the settle window reset the timer every time, so a *trailing*
 * debounce writes nothing at all for as long as the burst lasts — starving
 * exactly the channel a member is most likely to reload in the middle of. The
 * max-wait forces a write through when one has not landed for that long, which
 * turns "no writes during a burst" into "at most one write every five seconds".
 */
const TAIL_WRITE_TIMING = { debounceMs: 1_000, maxWaitMs: 5_000 } as const;

interface PersistTiming {
  debounceMs: number;
  maxWaitMs: number;
}

function scopeKey(scope: FirstChunkScope | null): string | null {
  return scope ? `${scope.userId}\u0000${scope.chapterId}` : null;
}

/**
 * The tenant whose rows this browser may read and write, or `null` until both
 * halves are known.
 *
 * Re-exported rather than derived here: the outbound drafts/outbox database
 * (`offline-queue.ts`) keys on the same scope, and one definition is the whole
 * point — see `chat-scope.ts` for why both halves come from local state, and
 * why this is deliberately not gated on the chapter store's `hasHydrated`.
 */
export { useChatScope as useFirstChunkScope };

/**
 * `true` when the data in hand was fetched under the scope currently in effect.
 *
 * See the module header — this is the whole cross-tenant write guard.
 *
 * **It compares identity, not time.** The first version of this compared
 * `dataUpdatedAt` against a `Date.now()` taken when the scope changed, and a
 * spec caught it: the two can land in the same millisecond, and then the
 * outgoing tenant's rows pass a `>=` and get written under the incoming
 * tenant's key. Clock resolution is not a thing to rest a tenancy boundary on,
 * and "unlikely" is not a guarantee.
 *
 * So the rule is instead: at the moment a new scope becomes current, remember
 * the `dataUpdatedAt` that was in hand at that boundary, and refuse to write
 * until the value *differs* — that is, until a fetch has actually resolved
 * since the switch. TanStack stamps a new `dataUpdatedAt` on every resolution
 * and on every `setQueryData`, so "differs" means "this is not the row I was
 * holding when the tenant changed", which is exactly the question being asked.
 * No arithmetic, no clock.
 *
 * The stamp is taken in an effect rather than during render, because
 * `Date.now()` was impure and a ref written during render is its own hazard.
 * Callers invoke this hook *before* declaring their persist effect and React
 * runs a component's effects in declaration order, so the stamp is recorded
 * first — and the `stamp.key === key` test means that even if it were not, the
 * stamp would still name the outgoing scope and the write would be refused.
 * Every failure mode here costs one skipped write, which is one cold load.
 */
function usePersistUnderScope(
  scope: FirstChunkScope | null,
  dataUpdatedAt: number,
  write: (scope: FirstChunkScope) => void,
  timing?: PersistTiming,
  subject?: string | null,
): void {
  const key = scopeKey(scope);
  const stamp = useRef<{ key: string | null; seen: number }>({
    key: null,
    seen: 0,
  });
  const lastWrite = useRef(0);
  const hasHadScope = useRef(false);

  /*
    The max-wait throttle belongs to the thing being written, not to this hook.
    Without this reset, switching from a channel read ten seconds ago makes the
    new channel's first update look overdue, so it writes synchronously and
    skips the settle window on exactly the transition that window is for.
  */
  useEffect(() => {
    lastWrite.current = 0;
  }, [subject]);

  /*
    The boundary stamp. Declared before the write effect below, and React runs
    a component's effects in declaration order, so on the commit that publishes
    a new scope this records what was in hand *before* anything tries to write
    it.

    Keyed on the scope alone, and `dataUpdatedAt` is read from the closure of
    that render — the value as of the boundary, deliberately not the latest.
    Taking it as a dependency would re-stamp on every fetch, which is precisely
    the thing that must not happen: the stamp would then always equal the
    current value and the guard would never let anything through.
  */
  useEffect(() => {
    /*
      The FIRST scope this instance sees is hydration, not a swap, and must not
      be guarded against.

      `["channels"]` is fetched on every dashboard route — `FindBar` calls
      `useChannels()` from the top bar — so by the time `ChatProvider` mounts
      the list has usually resolved already. Stamping that value would refuse
      the write, and with `staleTime: 60_000` no refetch is due, so nothing
      would ever be cached for a member who reaches `/chat` by in-app
      navigation. It fails closed permanently rather than for one pass, which
      is the one way this guard could be worse than no guard.

      Nothing stale can be in hand at that point anyway: a scope only changes
      without a remount through the swap path below, so on a first mount the
      data in the client was fetched under this very scope.
    */
    const isFirstScope = !hasHadScope.current;
    if (key !== null) hasHadScope.current = true;
    stamp.current = { key, seen: isFirstScope ? 0 : dataUpdatedAt };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the boundary value is the point; see above
  }, [key]);

  useEffect(() => {
    if (!scope || key === null) return;
    // The stamp names another scope: this pass is the one where the tree has
    // the new tenant and the old tenant's rows. Refuse, and wait for a fetch.
    if (stamp.current.key !== key) return;
    // Nothing has resolved since the boundary, so these rows are still the
    // outgoing tenant's. `!==` rather than `>` on purpose — see the header.
    if (dataUpdatedAt <= 0 || dataUpdatedAt === stamp.current.seen) return;
    if (!timing) {
      write(scope);
      return;
    }
    const commit = () => {
      lastWrite.current = Date.now();
      write(scope);
    };
    const now = Date.now();
    // Arm on the first eligible update rather than treating "never written"
    // as "overdue", which would fire immediately and defeat the settle window.
    if (lastWrite.current === 0) lastWrite.current = now;
    if (now - lastWrite.current >= timing.maxWaitMs) {
      commit();
      return;
    }
    const timer = setTimeout(commit, timing.debounceMs);
    return () => clearTimeout(timer);
  }, [scope, key, dataUpdatedAt, write, timing]);
}

function seedQuery(
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
  */
  void queryClient.invalidateQueries(
    { queryKey, exact: true, refetchType: "all" },
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
 * their own pending bubble over a skeleton and nothing else.
 *
 * A confirmed row is the honest signal: only `mergeServerRows` produces one,
 * and only a backfill, a realtime echo or this seed calls it.
 */
function hasServerRows(cache: ChannelCache | undefined): boolean {
  if (!cache) return false;
  return Object.values(cache.byId).some(
    (message) => message._status === "confirmed",
  );
}

/** Exported for the spec: the seed step on its own, with no IndexedDB in it. */
export function seedFirstChunk(
  queryClient: QueryClient,
  chunk: FirstChunk,
): void {
  if (chunk.channels && queryClient.getQueryData(["channels"]) === undefined) {
    seedQuery(
      queryClient,
      ["channels"],
      chunk.channels.channels,
      chunk.channels.cachedAt,
    );
  }
  for (const tail of chunk.tails) {
    const key = chatMessagesKey(tail.channelId);
    const existing = queryClient.getQueryData<ChannelCache>(key);
    // A fetch already won the race: disk must never overwrite the server.
    if (hasServerRows(existing)) continue;
    /*
      Merged onto what is there rather than replacing it, and rehydrated
      through the canonical merge rather than by restoring a `ChannelCache`
      shape this module would then own a second copy of.

      `existing` here is the outbox's work — queued and failed rows keyed by
      `client_message_id`, which `mergeServerRows` preserves because no server
      row shares those keys. Replacing it would drop the member's unsent
      messages off the timeline until the next hydrate.
    */
    seedQuery(
      queryClient,
      key,
      mergeServerRows(existing ?? emptyCache(), tail.rows),
      tail.cachedAt,
    );
  }
}

/**
 * Mounted once, by `ChatProvider`. Seeds this tenant's rows into the
 * `QueryClient`, prunes every other tenant's, and keeps the channel list
 * written.
 *
 * **Seed first, prune after.** The prune is the backstop for a wipe that never
 * landed (`first-chunk-cache.ts` § `pruneForeignScopes`) — but it protects
 * nothing about *this* paint, because a read is a lookup at the current scope
 * and cannot reach a foreign key in the first place. Running it in front would
 * put a full key scan between a cold load and the rows it exists to paint.
 */
export function useFirstChunkCache(): void {
  const scope = useChatScope();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void (async () => {
      const chunk = await readFirstChunk(scope);
      if (cancelled) return;
      try {
        seedFirstChunk(queryClient, chunk);
      } catch {
        /*
          The one step with no swallow of its own — `readFirstChunk` and
          `pruneForeignScopes` each have theirs. Without this a row written by
          an older build could reject out of this chain, which would both
          contradict the module's stated posture and skip the prune on the next
          line, quietly retiring the guaranteed half of the wipe for the
          session.
        */
      }
      await pruneForeignScopes(scope);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, queryClient]);

  // A second observer on `["channels"]`, not a second fetch: `ChatShell` and
  // the top bar's `FindBar` mount the same key, and TanStack dedupes. This one
  // exists so the write lives beside the read rather than in a component that
  // has no other reason to know about the cache.
  const channelsQuery = useChannels();
  const channelsData = channelsQuery.data;
  const channelsUpdatedAt = channelsQuery.dataUpdatedAt;

  const writeChannels = useCallback(
    (current: FirstChunkScope) => {
      void writeChannelList(
        current,
        asArray<ChatChannel>(channelsData),
        channelsUpdatedAt,
      );
    },
    [channelsData, channelsUpdatedAt],
  );

  usePersistUnderScope(scope, channelsUpdatedAt, writeChannels);
}

/**
 * Called by `useChatChannel` for the channel it is showing.
 *
 * Debounced: every realtime merge bumps `dataUpdatedAt`, so a busy channel
 * would otherwise rewrite the same thirty rows once per arriving message.
 * Trailing-edge, and the pending timer is dropped when the channel changes —
 * so switching away mid-burst writes the channel you switched *to*, never a
 * tail under the wrong `channelId`.
 */
export function usePersistedChannelTail(
  channelId: string | null,
  messages: ChatMessage[],
  dataUpdatedAt: number,
): void {
  const scope = useChatScope();

  const writeTail = useCallback(
    (current: FirstChunkScope) => {
      if (!channelId) return;
      void writeChannelTail(current, channelId, messages, dataUpdatedAt);
    },
    [channelId, messages, dataUpdatedAt],
  );

  usePersistUnderScope(
    scope,
    dataUpdatedAt,
    writeTail,
    TAIL_WRITE_TIMING,
    channelId,
  );
}
