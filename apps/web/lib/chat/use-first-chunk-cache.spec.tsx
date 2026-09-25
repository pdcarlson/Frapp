/** @vitest-environment jsdom */
/*
  The React half: what a cold load paints from the cache, and — the part with
  teeth — what it refuses to write back.

  IndexedDB is mocked out here on purpose. `first-chunk-cache.spec.ts` puts the
  real schema in front of a real key-range query and owns the claim that the
  keys isolate tenants; this file owns the claim that the *right scope* reaches
  those keys in the first place, which is a question about React's commit
  ordering and nothing to do with storage.
*/
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatMessagesKey,
  normalizeRow,
  type ChannelCache,
} from "@repo/chat-core/types";
import { selectMessages } from "@repo/chat-core/cache";
import type { ChatChannel } from "@/components/chat/channel-list";
import { useChapterStore } from "@/lib/stores/chapter-store";
import type { FirstChunk } from "./first-chunk-cache";

const {
  authUserId,
  blockListResult,
  channelsResult,
  pruneForeignScopes,
  readFirstChunk,
  viewerResult,
  writeChannelList,
  writeChannelTail,
  writeBlockFloor,
  writeViewerId,
} = vi.hoisted(() => ({
  authUserId: { current: null as string | null },
  /** `useBlockedUserIds` as far as the floor's writer reads it. */
  blockListResult: {
    current: {
      status: "loading" as "ready" | "loading" | "unavailable",
      ids: new Set<string>() as ReadonlySet<string>,
      unblocked: new Set<string>() as ReadonlySet<string>,
      readAt: 0,
    },
  },
  channelsResult: {
    current: { data: undefined as unknown, dataUpdatedAt: 0 },
  },
  /** `["user","me"]` as the hooks expose it: the narrowed id and the stamp. */
  viewerResult: {
    current: { id: null as string | null, dataUpdatedAt: 0 },
  },
  pruneForeignScopes: vi.fn(async () => undefined),
  readFirstChunk: vi.fn<() => Promise<FirstChunk>>(async () => ({
    channels: null,
    tails: [],
    viewer: null,
    blockFloor: null,
  })),
  writeChannelList: vi.fn(async () => undefined),
  writeChannelTail: vi.fn(async () => undefined),
  writeBlockFloor: vi.fn(async () => undefined),
  writeViewerId: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/use-auth-user-id", () => ({
  useAuthUserId: () => authUserId.current,
}));
vi.mock("@repo/hooks", () => ({
  useBlockedUserIds: () => blockListResult.current,
  useChannels: () => channelsResult.current,
  useCurrentUser: () => viewerResult.current,
  useViewerUserId: () => viewerResult.current.id,
}));
vi.mock("./first-chunk-cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  pruneForeignScopes,
  readFirstChunk,
  writeChannelList,
  writeChannelTail,
  writeBlockFloor,
  writeViewerId,
}));

import {
  seedFirstChunk,
  useFirstChunkCache,
  useFirstChunkScope,
  usePersistedChannelTail,
} from "./use-first-chunk-cache";

const GENERAL: ChatChannel = { id: "c1", name: "general", type: "PUBLIC" };
const SOCIAL: ChatChannel = { id: "c2", name: "social", type: "PUBLIC" };

const AT = Date.now();

function listRow(channels: ChatChannel[], cachedAt = AT) {
  return { userId: "auth-alice", chapterId: "chapter-1", channels, cachedAt };
}

/** A cached `users.id` row for a scope — `viewerUserId` is not `userId`. */
function viewerRow(
  viewerUserId: string,
  scope = { userId: "auth-alice", chapterId: "chapter-1" },
  cachedAt = AT,
) {
  return { ...scope, viewerUserId, cachedAt };
}

const EMPTY_CHUNK: FirstChunk = {
  channels: null,
  tails: [],
  viewer: null,
  blockFloor: null,
};

function message(id: string) {
  return normalizeRow({
    id,
    channel_id: "chan-1",
    sender_id: "user-1",
    content: `message ${id}`,
    created_at: `2026-09-14T10:00:0${id}.000Z`,
    client_message_id: `client-${id}`,
  });
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  authUserId.current = "auth-alice";
  channelsResult.current = { data: undefined, dataUpdatedAt: 0 };
  viewerResult.current = { id: null, dataUpdatedAt: 0 };
  blockListResult.current = {
    status: "loading",
    ids: new Set(),
    unblocked: new Set(),
    readAt: 0,
  };
  vi.clearAllMocks();
  readFirstChunk.mockResolvedValue(EMPTY_CHUNK);
  act(() => useChapterStore.getState().setActiveChapterId("chapter-1"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFirstChunkScope", () => {
  it("is null until both halves of the key are known", () => {
    authUserId.current = null;
    const { result, rerender } = renderHook(() => useFirstChunkScope());
    expect(result.current).toBeNull();

    act(() => useChapterStore.getState().setActiveChapterId(null));
    authUserId.current = "auth-alice";
    rerender();
    expect(result.current).toBeNull();

    act(() => useChapterStore.getState().setActiveChapterId("chapter-1"));
    rerender();
    expect(result.current).toEqual({
      userId: "auth-alice",
      chapterId: "chapter-1",
    });
  });
});

describe("seedFirstChunk", () => {
  it("paints a cached channel list into the query the rail reads", () => {
    const client = makeClient();

    seedFirstChunk(client, {
      channels: listRow([GENERAL, SOCIAL]),
      tails: [],
      viewer: null,
      blockFloor: null,
    });

    // `chat-shell.tsx` derives `channelsPaneState` from `channels.length > 0`,
    // so a seeded list is what moves the rail from `loading` to `ready`
    // without a round trip. That derivation is the whole wiring — nothing in
    // the shell had to change for the cache to paint.
    expect(client.getQueryData(["channels"])).toEqual([GENERAL, SOCIAL]);
  });

  it("paints a cached tail as real, ordered messages", () => {
    const client = makeClient();

    seedFirstChunk(client, {
      channels: null,
      viewer: null,
      blockFloor: null,
      tails: [
        {
          userId: "auth-alice",
          chapterId: "chapter-1",
          channelId: "chan-1",
          rows: [message("1"), message("2")],
          cachedAt: AT,
        },
      ],
    });

    const cache = client.getQueryData<ChannelCache>(chatMessagesKey("chan-1"));
    expect(selectMessages(cache).map((row) => row.content)).toEqual([
      "message 1",
      "message 2",
    ]);
    // Rehydrated through `mergeServerRows`, so every restored row carries the
    // status a server row carries — not a resurrected optimistic one.
    expect(selectMessages(cache).every((row) => row._status === "confirmed")).toBe(
      true,
    );
  });

  it("merges onto the outbox's rows rather than being locked out by them", () => {
    /*
      The offline member's case, and the one this cache exists for.

      `useChatChannel`'s mount effect runs `hydrateOutboxIntoCache`, which
      `setQueryData`s the member's queued rows into this very key before the
      seed can get there. A "skip if anything is present" guard therefore
      refused to paint for exactly the member with unsent messages — they saw
      their own pending bubble over a skeleton and nothing else. Presence is
      not the question; whether a *fetch* answered is.
    */
    const client = makeClient();
    const queued = { ...message("9"), _status: "pending" as const };
    client.setQueryData(chatMessagesKey("chan-1"), {
      byId: { [queued.client_message_id]: queued },
      order: [queued.client_message_id],
      actionIndex: {},
    } satisfies ChannelCache);

    seedFirstChunk(client, {
      channels: null,
      viewer: null,
      blockFloor: null,
      tails: [
        {
          userId: "auth-alice",
          chapterId: "chapter-1",
          channelId: "chan-1",
          rows: [message("1"), message("2")],
          cachedAt: AT,
        },
      ],
    });

    const painted = selectMessages(
      client.getQueryData<ChannelCache>(chatMessagesKey("chan-1")),
    );
    // The cached history paints, and the member's unsent message is still on
    // the timeline rather than replaced by it.
    expect(painted.map((row) => row.content)).toEqual([
      "message 1",
      "message 2",
      "message 9",
    ]);
  });

  it("leaves a channel alone once real server rows are in it", () => {
    // The other half of the same guard: a confirmed row means the backfill
    // answered, and disk must never overwrite the server.
    const client = makeClient();
    const fromServer = message("5");
    client.setQueryData(chatMessagesKey("chan-1"), {
      byId: { [fromServer.client_message_id]: fromServer },
      order: [fromServer.client_message_id],
      actionIndex: {},
    } satisfies ChannelCache);

    seedFirstChunk(client, {
      channels: null,
      viewer: null,
      blockFloor: null,
      tails: [
        {
          userId: "auth-alice",
          chapterId: "chapter-1",
          channelId: "chan-1",
          rows: [message("1")],
          cachedAt: AT,
        },
      ],
    });

    const painted = selectMessages(
      client.getQueryData<ChannelCache>(chatMessagesKey("chan-1")),
    );
    expect(painted.map((row) => row.content)).toEqual(["message 5"]);
  });

  it("does not cancel the fetch already on its way", () => {
    /*
      `invalidateQueries` forwards to `refetchQueries`, whose `cancelRefetch`
      defaults to true — and `Query.fetch` reads that as "abort and restart"
      once `state.data` is defined, which the seed has just made true. Left
      alone, a cache hit would abort the in-flight `GET`, reissue it from zero,
      and land the authoritative list *later* than with no cache at all.
    */
    const client = makeClient();
    let aborts = 0;
    client.setQueryDefaults(["channels"], {
      queryFn: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborts += 1;
          });
          setTimeout(() => resolve([SOCIAL]), 50);
        }),
    });
    const observer = client
      .getQueryCache()
      .build(client, { queryKey: ["channels"] });
    void observer.fetch();

    seedFirstChunk(client, {
      channels: listRow([GENERAL]),
      tails: [],
      viewer: null,
      blockFloor: null,
    });

    expect(aborts).toBe(0);
  });

  it("never overwrites a fetch that already resolved", () => {
    /*
      The race this exists for: IndexedDB is fast but the network is sometimes
      faster, and a cache that could clobber live rows would be worse than no
      cache at all.
    */
    const client = makeClient();
    client.setQueryData(["channels"], [SOCIAL]);

    seedFirstChunk(client, {
      channels: listRow([GENERAL]),
      tails: [],
      viewer: null,
      blockFloor: null,
    });

    expect(client.getQueryData(["channels"])).toEqual([SOCIAL]);
  });

  it("marks what it seeded invalidated, so the live fetch still runs", () => {
    /*
      Without this the cache would paint and nothing would correct it:
      `["chat", id, "messages"]` is `staleTime: Infinity` and `["channels"]` is
      60s, so seeded data is *fresh* data as far as TanStack is concerned and
      no observer would refetch. Invalidation overrides staleness, which is
      what makes "cached first, live wins" true rather than aspirational.
    */
    const client = makeClient();

    seedFirstChunk(client, {
      channels: listRow([GENERAL]),
      tails: [],
      viewer: null,
      blockFloor: null,
    });

    expect(client.getQueryState(["channels"])?.isInvalidated).toBe(true);
  });
});

describe("useFirstChunkCache", () => {
  it("reads and seeds before it prunes, so hygiene never blocks the paint", async () => {
    /*
      A read is a lookup at the current scope and cannot reach a foreign key,
      so the prune protects nothing about this paint — putting its key scan in
      front of the seed would just spend the milliseconds the cache exists to
      save.
    */
    const order: string[] = [];
    pruneForeignScopes.mockImplementation(async () => {
      order.push("prune");
    });
    readFirstChunk.mockImplementation(async () => {
      order.push("read");
      return EMPTY_CHUNK;
    });
    const client = makeClient();

    renderHook(() => useFirstChunkCache(), { wrapper: wrapper(client) });

    await waitFor(() => expect(order).toEqual(["read", "prune"]));
  });

  it("seeds what it read into the query client", async () => {
    readFirstChunk.mockResolvedValue({
      channels: listRow([GENERAL]),
      tails: [],
      viewer: null,
      blockFloor: null,
    });
    const client = makeClient();

    renderHook(() => useFirstChunkCache(), { wrapper: wrapper(client) });

    await waitFor(() =>
      expect(client.getQueryData(["channels"])).toEqual([GENERAL]),
    );
  });

  it("does nothing at all before the scope is known", async () => {
    authUserId.current = null;
    const client = makeClient();

    renderHook(() => useFirstChunkCache(), { wrapper: wrapper(client) });

    await waitFor(() => expect(pruneForeignScopes).not.toHaveBeenCalled());
    expect(readFirstChunk).not.toHaveBeenCalled();
    expect(writeChannelList).not.toHaveBeenCalled();
  });

  it("writes the channel list once the live fetch resolves under this scope", async () => {
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });

    channelsResult.current = { data: [GENERAL], dataUpdatedAt: Date.now() + 1 };
    rerender();

    await waitFor(() =>
      expect(writeChannelList).toHaveBeenCalledWith(
        { userId: "auth-alice", chapterId: "chapter-1" },
        [GENERAL],
        expect.any(Number),
      ),
    );
  });

  it("refuses to file the outgoing chapter's channels under the incoming one", async () => {
    /*
      The cross-tenant write, and the reason `canPersist` exists.

      `dropCacheWhenIdentityChanges` clears the QueryClient from an effect on an
      ancestor of this tree, and React runs child effects first — so on the
      commit that publishes a new chapter there is one pass where this hook sees
      the new scope beside the old chapter's rows. Writing then would put
      chapter-1's channel list under chapter-2's key, where chapter-2's next
      cold load would read it back and paint it. The gate refuses any data
      whose `dataUpdatedAt` predates the scope it is now being offered under.
    */
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    const fetchedUnderChapterOne = Date.now() + 1;
    channelsResult.current = {
      data: [GENERAL],
      dataUpdatedAt: fetchedUnderChapterOne,
    };
    rerender();
    await waitFor(() => expect(writeChannelList).toHaveBeenCalled());
    writeChannelList.mockClear();

    // The switch commits: new chapter, same stale rows still in hand.
    act(() => useChapterStore.getState().setActiveChapterId("chapter-2"));
    rerender();

    await waitFor(() => expect(pruneForeignScopes).toHaveBeenCalledTimes(2));
    expect(writeChannelList).not.toHaveBeenCalled();

    // ...and the refetch that follows the clear is written, so the guard costs
    // one pass rather than disabling the cache for the rest of the session.
    channelsResult.current = { data: [SOCIAL], dataUpdatedAt: Date.now() + 50 };
    rerender();
    await waitFor(() =>
      expect(writeChannelList).toHaveBeenCalledWith(
        { userId: "auth-alice", chapterId: "chapter-2" },
        [SOCIAL],
        expect.any(Number),
      ),
    );
  });

  it("refuses the same way when the member changes but the chapter does not", async () => {
    // A same-tab magic-link swap keeps the chapter, so only the auth uid moves
    // — `multi-tenancy.md`'s account-swap case, and why the key is the auth uid
    // rather than the chapter alone.
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    channelsResult.current = { data: [GENERAL], dataUpdatedAt: Date.now() + 1 };
    rerender();
    await waitFor(() => expect(writeChannelList).toHaveBeenCalled());
    writeChannelList.mockClear();

    authUserId.current = "auth-bob";
    rerender();

    await waitFor(() => expect(pruneForeignScopes).toHaveBeenCalledTimes(2));
    expect(writeChannelList).not.toHaveBeenCalled();
  });
});

/*
  The identity half (#2249).

  `first-chunk-cache.spec.ts` owns the claim that the *keys* isolate one
  member's `users.id` from another's. This owns the claim that the id the hook
  hands back is the one for the scope in effect **right now** — which is a
  question about React holding state across a commit, and nothing to do with
  storage.
*/
describe("useFirstChunkCache — cached viewer id", () => {
  const ALICE_VIEWER = "user-alice";
  const BOB_VIEWER = "user-bob";

  it("hands back the cached id for this scope", async () => {
    readFirstChunk.mockResolvedValue({
      ...EMPTY_CHUNK,
      viewer: viewerRow(ALICE_VIEWER),
    });
    const client = makeClient();

    const { result } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });

    // The point of the whole change: a resolved id with no `GET /v1/users/me`
    // behind it, so `message-timeline.tsx`'s gate opens on the warm path.
    await waitFor(() => expect(result.current.viewerId).toBe(ALICE_VIEWER));
  });

  it("does not seed `[\"user\",\"me\"]` with it", async () => {
    /*
      The one thing #2249 rules out by name. That key's consumers —
      `account-menu`, `profile-panel`, `billing-page` — read a whole profile, and
      a row holding only an id would be a worse bug than the one being fixed. It
      is also the key `caching.md` says a persister must never resurrect, so
      touching it here would be the objection landing rather than being answered.
    */
    readFirstChunk.mockResolvedValue({
      ...EMPTY_CHUNK,
      viewer: viewerRow(ALICE_VIEWER),
    });
    const client = makeClient();

    const { result } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.viewerId).toBe(ALICE_VIEWER));

    expect(client.getQueryData(["user", "me"])).toBeUndefined();
  });

  it("disowns the id the moment the member changes, before the re-read lands", async () => {
    /*
      **The A-as-B guard, and the reason this is state-with-a-scope rather than a
      bare string.**

      A same-tab magic-link swap does not remount this tree. The `QueryClient` is
      cleared and the database is wiped from an ancestor effect, but this
      component keeps rendering — so a bare `string` would still be Alice's
      `users.id` on every commit until the asynchronous re-read resolved. Bob's
      rows can arrive from the network inside that window, and painting them
      against Alice's id is the cross-account authorship bug with a cache behind
      it instead of a race.

      `readFirstChunk` is held unresolved here precisely to stand in that window
      and prove the value is gone *without* waiting for anything.
    */
    readFirstChunk.mockResolvedValue({
      ...EMPTY_CHUNK,
      viewer: viewerRow(ALICE_VIEWER),
    });
    const client = makeClient();
    const { result, rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.viewerId).toBe(ALICE_VIEWER));

    // Bob signs in. Nothing resolves for him — the read never settles.
    readFirstChunk.mockReturnValue(new Promise(() => {}));
    authUserId.current = "auth-bob";
    rerender();

    expect(result.current.viewerId).toBeNull();
  });

  it("disowns it on a chapter change too", async () => {
    // Same member, so the id itself is still correct — but the rows it
    // attributes were dropped wholesale by the chapter switch, and a cache that
    // kept answering for a scope it was not read under is one rule away from
    // the account-swap case above. It goes cold the same way.
    readFirstChunk.mockResolvedValue({
      ...EMPTY_CHUNK,
      viewer: viewerRow(ALICE_VIEWER),
    });
    const client = makeClient();
    const { result, rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.viewerId).toBe(ALICE_VIEWER));

    readFirstChunk.mockReturnValue(new Promise(() => {}));
    act(() => useChapterStore.getState().setActiveChapterId("chapter-2"));
    rerender();

    expect(result.current.viewerId).toBeNull();
  });

  it("goes cold when the session does, rather than going sticky", async () => {
    // The read cache's standing posture (`chat-scope.ts`): an outbox may not go
    // cold on an uncertain identity because that loses a message, but a read
    // cache must. No scope, no cached id, and the gate closes again.
    readFirstChunk.mockResolvedValue({
      ...EMPTY_CHUNK,
      viewer: viewerRow(ALICE_VIEWER),
    });
    const client = makeClient();
    const { result, rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.viewerId).toBe(ALICE_VIEWER));

    authUserId.current = null;
    rerender();

    expect(result.current.viewerId).toBeNull();
  });

  it("writes the live id under the scope it resolved in", async () => {
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });

    viewerResult.current = { id: ALICE_VIEWER, dataUpdatedAt: Date.now() + 1 };
    rerender();

    await waitFor(() =>
      expect(writeViewerId).toHaveBeenCalledWith(
        { userId: "auth-alice", chapterId: "chapter-1" },
        ALICE_VIEWER,
        expect.any(Number),
      ),
    );
  });

  it("does not write the outgoing member's id under the incoming member's key", async () => {
    /*
      The write-side half of the same boundary, and the one that would be a real
      leak rather than a stale paint: `dropCacheWhenIdentityChanges` clears from
      an *ancestor* effect and React flushes child effects first, so there is one
      commit where this hook holds Bob's scope beside Alice's `["user","me"]`
      row. Filing Alice's `users.id` under Bob's key there would make every
      later read of Bob's cache hand back Alice's identity — from disk, durably.
    */
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    viewerResult.current = { id: ALICE_VIEWER, dataUpdatedAt: Date.now() + 1 };
    rerender();
    await waitFor(() => expect(writeViewerId).toHaveBeenCalled());
    writeViewerId.mockClear();

    // Bob's uid publishes. Alice's row is still the one in hand — same
    // `dataUpdatedAt`, because nothing has resolved since the swap.
    authUserId.current = "auth-bob";
    rerender();

    expect(writeViewerId).not.toHaveBeenCalled();

    // And it stays refused until `["user","me"]` actually answers for Bob.
    viewerResult.current = { id: BOB_VIEWER, dataUpdatedAt: Date.now() + 2 };
    rerender();
    await waitFor(() =>
      expect(writeViewerId).toHaveBeenCalledWith(
        { userId: "auth-bob", chapterId: "chapter-1" },
        BOB_VIEWER,
        expect.any(Number),
      ),
    );
  });

  it("does not write while identity is unresolved", async () => {
    // `usePersistUnderScope` fires on a changed `dataUpdatedAt`, and a
    // `["user","me"]` *error* produces one too. Writing then would stamp a fresh
    // `cachedAt` on nothing and push the good row's expiry out with it.
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });

    viewerResult.current = { id: null, dataUpdatedAt: Date.now() + 1 };
    rerender();
    await waitFor(() => expect(pruneForeignScopes).toHaveBeenCalled());

    expect(writeViewerId).not.toHaveBeenCalled();
  });
});

/*
  The block list's floor (#2688): read with the tails, handed back for the
  scope in effect only, and written from a ready read under the same tenant
  guard as everything else here.
*/
describe("useFirstChunkCache — block-list floor", () => {
  const BLAKE = "user-blake";

  function floorRow(
    ids: string[],
    scope = { userId: "auth-alice", chapterId: "chapter-1" },
  ) {
    return { ...scope, ids, readAt: AT };
  }

  it("hands back the cached floor for this scope, read with the rows", async () => {
    readFirstChunk.mockResolvedValue({
      ...EMPTY_CHUNK,
      blockFloor: floorRow([BLAKE]),
    });
    const client = makeClient();

    const { result } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });

    await waitFor(() =>
      expect([...(result.current.blockFloor ?? [])]).toEqual([BLAKE]),
    );
  });

  it("disowns the floor the moment the member changes", async () => {
    // Bob must never classify his thread against Alice's blocks.
    readFirstChunk.mockResolvedValue({
      ...EMPTY_CHUNK,
      blockFloor: floorRow([BLAKE]),
    });
    const client = makeClient();
    const { result, rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.blockFloor).not.toBeNull());

    readFirstChunk.mockReturnValue(new Promise(() => {}));
    authUserId.current = "auth-bob";
    rerender();

    expect(result.current.blockFloor).toBeNull();
  });

  it("writes a ready read's ids, and nothing while the list is not ready", async () => {
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });

    // A list that is unavailable after a read still holds ids (the floor
    // plus confirmed changes) but is not news the floor may be rewritten from.
    blockListResult.current = {
      status: "unavailable",
      ids: new Set([BLAKE]),
      unblocked: new Set(),
      readAt: 0,
    };
    rerender();
    await waitFor(() => expect(pruneForeignScopes).toHaveBeenCalled());
    expect(writeBlockFloor).not.toHaveBeenCalled();

    const readAt = Date.now() + 1;
    blockListResult.current = {
      status: "ready",
      ids: new Set([BLAKE]),
      unblocked: new Set(),
      readAt,
    };
    rerender();

    await waitFor(() =>
      expect(writeBlockFloor).toHaveBeenCalledWith(
        { userId: "auth-alice", chapterId: "chapter-1" },
        new Set([BLAKE]),
        readAt,
      ),
    );
  });

  it("does not file the outgoing member's blocks under the incoming member's key", async () => {
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    blockListResult.current = {
      status: "ready",
      ids: new Set([BLAKE]),
      unblocked: new Set(),
      readAt: Date.now() + 1,
    };
    rerender();
    await waitFor(() => expect(writeBlockFloor).toHaveBeenCalled());
    writeBlockFloor.mockClear();

    // Bob's uid publishes with Alice's list still in hand.
    authUserId.current = "auth-bob";
    rerender();
    expect(writeBlockFloor).not.toHaveBeenCalled();

    // Bob's own read is written.
    blockListResult.current = {
      status: "ready",
      ids: new Set(),
      unblocked: new Set(),
      readAt: Date.now() + 2,
    };
    rerender();
    await waitFor(() =>
      expect(writeBlockFloor).toHaveBeenCalledWith(
        { userId: "auth-bob", chapterId: "chapter-1" },
        new Set(),
        expect.any(Number),
      ),
    );
  });
});

describe("useFirstChunkCache — block-list floor after a failed refetch", () => {
  it("does not rewrite the floor from a list that read once and is now unavailable", async () => {
    /*
      TanStack keeps a failed refetch's `data`, so `readAt` stays nonzero while
      the list is unavailable, and a confirmed change still moves its ids. The
      floor must not be rewritten from that: an unblock confirmed during the
      outage leaves the floor naming the member until a read succeeds.
    */
    const client = makeClient();
    const { rerender } = renderHook(() => useFirstChunkCache(), {
      wrapper: wrapper(client),
    });
    const readAt = Date.now() + 1;
    blockListResult.current = {
      status: "ready",
      ids: new Set(["user-blake"]),
      unblocked: new Set(),
      readAt,
    };
    rerender();
    await waitFor(() => expect(writeBlockFloor).toHaveBeenCalledTimes(1));

    // The refetch fails, then an unblock is confirmed during the outage.
    blockListResult.current = {
      status: "unavailable",
      ids: new Set(),
      unblocked: new Set(["user-blake"]),
      readAt,
    };
    rerender();
    await waitFor(() => expect(pruneForeignScopes).toHaveBeenCalled());

    expect(writeBlockFloor).toHaveBeenCalledTimes(1);
  });
});

describe("usePersistedChannelTail", () => {
  it("writes the tail once the timeline settles", async () => {
    /*
      Mounts pending (`dataUpdatedAt: 0`) and then resolves, which is what a
      cold load does: `useChatChannel`'s query has no data until the backfill
      lands. The write is gated on the data having *changed* since the scope
      boundary, so the fixture has to change it rather than arrive with it.
    */
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const messages = [message("1"), message("2")];
    const { rerender } = render(
      <Tail channelId="chan-1" messages={[]} dataUpdatedAt={0} />,
    );

    rerender(
      <Tail channelId="chan-1" messages={messages} dataUpdatedAt={1_700} />,
    );

    expect(writeChannelTail).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1_000));
    expect(writeChannelTail).toHaveBeenCalledWith(
      { userId: "auth-alice", chapterId: "chapter-1" },
      "chan-1",
      messages,
      expect.any(Number),
    );
  });

  it("does not write a tail under the channel the member just left", async () => {
    /*
      The debounce makes this reachable: a switch inside the settle window
      would otherwise fire with the new channel id and the old channel's rows.
      Clearing the timer on the channel change is what stops it.
    */
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = [message("1")];
    const second = [message("2")];
    const { rerender } = render(
      <Tail channelId="chan-1" messages={[]} dataUpdatedAt={0} />,
    );
    rerender(<Tail channelId="chan-1" messages={first} dataUpdatedAt={1_700} />);

    act(() => void vi.advanceTimersByTime(500));
    rerender(<Tail channelId="chan-2" messages={second} dataUpdatedAt={1_800} />);
    act(() => void vi.advanceTimersByTime(1_000));

    expect(writeChannelTail).toHaveBeenCalledTimes(1);
    expect(writeChannelTail).toHaveBeenCalledWith(
      expect.anything(),
      "chan-2",
      second,
      expect.any(Number),
    );
  });

  it("writes nothing while no channel is active", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    render(<Tail channelId={null} messages={[]} dataUpdatedAt={1_700} />);
    act(() => void vi.advanceTimersByTime(5_000));

    expect(writeChannelTail).not.toHaveBeenCalled();
  });

  it("refuses rows that have not been refetched since the scope changed, even in the same millisecond", () => {
    /*
      The regression this exists for. The guard used to compare
      `dataUpdatedAt` against a `Date.now()` taken at the scope boundary with
      `>=` — so a fetch that resolved in the *same millisecond* as a chapter
      switch cleared it, and the outgoing chapter's thirty messages were
      written under the incoming chapter's key. A spec caught it as a flake,
      which is the only way a clock-resolution bug ever shows up.

      Fixed numbers here, not `Date.now()`: the invariant is that the value
      must *differ* from the one in hand at the boundary, so the test must be
      able to hold it equal. It could not express that against a wall clock,
      which is the same reason the guard could not enforce it.
    */
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const rows = [message("1")];
    const { rerender } = render(
      <Tail channelId="chan-1" messages={[]} dataUpdatedAt={0} />,
    );
    rerender(<Tail channelId="chan-1" messages={rows} dataUpdatedAt={1_700} />);
    act(() => void vi.advanceTimersByTime(1_000));
    expect(writeChannelTail).toHaveBeenCalledTimes(1);
    writeChannelTail.mockClear();

    // The chapter switches. Same rows, same `dataUpdatedAt` — nothing has
    // resolved since, so these are still the outgoing chapter's messages.
    act(() => useChapterStore.getState().setActiveChapterId("chapter-2"));
    rerender(<Tail channelId="chan-1" messages={rows} dataUpdatedAt={1_700} />);
    act(() => void vi.advanceTimersByTime(5_000));

    expect(writeChannelTail).not.toHaveBeenCalled();
  });
});

function Tail({
  channelId,
  messages,
  dataUpdatedAt,
}: {
  channelId: string | null;
  messages: ReturnType<typeof message>[];
  dataUpdatedAt: number;
}) {
  usePersistedChannelTail(channelId, messages, dataUpdatedAt);
  return null;
}
