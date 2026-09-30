/**
 * Pins paging through a channel's history (#1571 web, #2772 mobile): the
 * newest page folds into the cache without dropping queued sends or Realtime
 * arrivals, and older pages merge into that same cache with no duplicate and
 * no reordering, down to the channel's first row.
 */

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  applyReactionInsert,
  emptyCache,
  mergeServerRow,
  mergeServerRows,
  selectMessages,
  upsertOptimistic,
} from "./cache";
import {
  ACTION_READ_LIMIT,
  createHistoryPageFetcher,
  createHistoryPager,
  FIRST_PAGE_LIMIT,
  IncompleteActionsError,
  hasOlderHistory,
  OLDER_PAGE_LIMIT,
  olderHistoryView,
  readNewestPage,
  readOlderPage,
  type FetchHistoryPage,
  type HistoryPageQuery,
} from "./history";
import {
  chatMessagesKey,
  optimisticMessage,
  type ChannelCache,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";

const CHANNEL = "c1";
const KEY = chatMessagesKey(CHANNEL);
const BASE = Date.parse("2026-09-01T00:00:00.000Z");

/** Row `n` was sent `n` seconds after `BASE`, so a higher number is newer. */
function row(
  n: number,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return {
    id: `m${n}`,
    channel_id: CHANNEL,
    sender_id: "u1",
    content: `message ${n}`,
    kind: "text",
    created_at: new Date(BASE + n * 1000).toISOString(),
    client_message_id: `cm${n}`,
    ...overrides,
  };
}

function rows(from: number, to: number): RawChatMessage[] {
  const out: RawChatMessage[] = [];
  for (let n = from; n <= to; n += 1) out.push(row(n));
  return out;
}

function reaction(id: string, messageId: string): RawChatMessageAction {
  return {
    id,
    message_id: messageId,
    user_id: "u2",
    action_type: "reaction:👍",
    payload: null,
    created_at: new Date(BASE).toISOString(),
  } as RawChatMessageAction;
}

/**
 * The API's read over `server`, as `findByChannel` builds it: newest first,
 * `before` strict, `limit` rows. Records every query it was asked.
 */
function fakeServer(server: RawChatMessage[]) {
  const queries: HistoryPageQuery[] = [];
  const fetchPage: FetchHistoryPage = async (_channelId, query) => {
    queries.push(query);
    const before = query.before ? Date.parse(query.before) : Infinity;
    const page = server
      .filter((r) => Date.parse(r.created_at) < before)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, query.limit);
    return { rows: page, actions: [] };
  };
  return { fetchPage, queries };
}

const ids = (cache: ChannelCache | undefined) =>
  selectMessages(cache).map((m) => m.id);

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
});

async function openChannel(fetchPage: FetchHistoryPage) {
  const newest = await readNewestPage(queryClient, CHANNEL, fetchPage);
  queryClient.setQueryData(KEY, newest.cache);
  return newest;
}

describe("readNewestPage", () => {
  test("reads the newest page, and records the start only when it came back short", async () => {
    const full = await openChannel(fakeServer(rows(1, 120)).fetchPage);
    expect(ids(full.cache)).toEqual(rows(71, 120).map((r) => r.id));
    expect(full.start).toBeUndefined();

    queryClient.clear();
    const short = await openChannel(fakeServer(rows(1, 7)).fetchPage);
    expect(short.start).toBe("m1");

    queryClient.clear();
    const empty = await openChannel(fakeServer([]).fetchPage);
    expect(empty.start).toBeNull();
  });

  test("keeps a queued send and a Realtime arrival that landed during the read", async () => {
    const queued = optimisticMessage({
      clientMessageId: "queued",
      channelId: CHANNEL,
      senderId: "u1",
      content: "sent during the spinner",
    });
    const server = fakeServer(rows(1, 60));
    // Both land while the request is in flight, so only a read of the cache
    // taken after the response (#2486) can see them.
    const duringRead: FetchHistoryPage = async (id, query) => {
      queryClient.setQueryData<ChannelCache>(
        KEY,
        mergeServerRow(upsertOptimistic(emptyCache(), queued), row(500)),
      );
      return server.fetchPage(id, query);
    };
    const { cache } = await readNewestPage(queryClient, CHANNEL, duringRead);
    expect(ids(cache)).toContain("m500");
    expect(
      selectMessages(cache).some((m) => m.client_message_id === "queued"),
    ).toBe(true);
  });

  test("paints a page whose action read was incomplete", async () => {
    const server = fakeServer(rows(1, 60));
    const { cache } = await readNewestPage(
      queryClient,
      CHANNEL,
      async (id, q) => ({
        ...(await server.fetchPage(id, q)),
        actionsIncomplete: true,
      }),
    );
    expect(ids(cache)).toHaveLength(FIRST_PAGE_LIMIT);
  });

  test("drops an older cached row the page did not re-read", async () => {
    // A row the server removed while this client missed it.
    queryClient.setQueryData<ChannelCache>(
      KEY,
      mergeServerRows(emptyCache(), rows(1, 60)),
    );
    const { cache } = await readNewestPage(
      queryClient,
      CHANNEL,
      fakeServer(rows(2, 60)).fetchPage,
    );
    expect(ids(cache)).not.toContain("m1");
    expect(ids(cache)).toHaveLength(FIRST_PAGE_LIMIT);
  });
});

describe("readOlderPage", () => {
  test("pages back to the first row with no duplicate and no reordering", async () => {
    const server = rows(1, 250);
    // An imported archive row is ordinary history: it pages in like any other.
    server[4] = row(5, {
      kind: "imported",
      sender_id: null,
      author_name: "old-handle",
    });
    const { fetchPage, queries } = fakeServer(server);
    await openChannel(fetchPage);

    const outcomes: string[] = [];
    let start: string | null | undefined;
    for (let i = 0; i < 10 && start === undefined; i += 1) {
      const read = await readOlderPage(queryClient, CHANNEL, fetchPage);
      outcomes.push(read.outcome);
      start = read.start;
    }

    const cache = queryClient.getQueryData<ChannelCache>(KEY);
    expect(ids(cache)).toEqual(server.map((r) => r.id));
    expect(new Set(ids(cache)).size).toBe(250);
    expect(selectMessages(cache).find((m) => m.id === "m5")?.kind).toBe(
      "imported",
    );
    expect(start).toBe("m1");
    expect(outcomes.at(-1)).toMatch(/loaded|start/);
    // Each cursor is the edge plus one millisecond, so a row sharing the
    // edge's instant is not skipped.
    expect(queries[1]).toEqual({
      limit: OLDER_PAGE_LIMIT,
      before: new Date(BASE + 201 * 1000 + 1).toISOString(),
    });
  });

  test("keeps the reactions and optimistic rows the cache already holds", async () => {
    const { fetchPage } = fakeServer(rows(1, 150));
    await openChannel(fetchPage);
    const queued = optimisticMessage({
      clientMessageId: "queued",
      channelId: CHANNEL,
      senderId: "u1",
      content: "offline",
    });
    queryClient.setQueryData<ChannelCache>(KEY, (current) =>
      upsertOptimistic(
        applyReactionInsert(current!, reaction("a1", "m101")),
        queued,
      ),
    );

    const read = await readOlderPage(queryClient, CHANNEL, fetchPage);

    // m2-m101: a full page (the overlap re-read m101), so no start yet.
    expect(read).toEqual({ outcome: "loaded" });
    const messages = selectMessages(
      queryClient.getQueryData<ChannelCache>(KEY),
    );
    // The overlap re-read m101; its accumulated reaction survived.
    expect(messages.find((m) => m.id === "m101")?.actions).toHaveLength(1);
    expect(messages.at(-1)?.client_message_id).toBe("queued");
    expect(messages).toHaveLength(150);
  });

  test("discards a page whose edge moved while it was in flight", async () => {
    const { fetchPage } = fakeServer(rows(1, 150));
    await openChannel(fetchPage);
    const slow: FetchHistoryPage = async (id, query) => {
      // A refetch landed meanwhile and moved the oldest row.
      queryClient.setQueryData<ChannelCache>(
        KEY,
        mergeServerRows(emptyCache(), rows(120, 150)),
      );
      return fetchPage(id, query);
    };

    const read = await readOlderPage(queryClient, CHANNEL, slow);

    expect(read).toEqual({ outcome: "stale" });
    expect(ids(queryClient.getQueryData<ChannelCache>(KEY))).toEqual(
      rows(120, 150).map((r) => r.id),
    );
  });

  test("falls back to the strict cursor when more than a page shares the edge's millisecond", async () => {
    const instant = new Date(BASE + 10_000).toISOString();
    const burst = rows(1, 160).map((r) => ({ ...r, created_at: instant }));
    const older = rows(1, 5).map((r) => ({
      ...r,
      id: `old${r.id}`,
      client_message_id: `old${r.id}`,
    }));
    queryClient.setQueryData<ChannelCache>(
      KEY,
      mergeServerRows(emptyCache(), burst.slice(0, 50)),
    );
    const queries: HistoryPageQuery[] = [];
    const fetchPage: FetchHistoryPage = async (_id, query) => {
      queries.push(query);
      if (query.before !== instant)
        return { rows: burst.slice(0, OLDER_PAGE_LIMIT), actions: [] };
      return { rows: older, actions: [] };
    };

    // The first read's overlapping cursor still reaches rows not held yet.
    const read = await readOlderPage(queryClient, CHANNEL, fetchPage);
    expect(read.outcome).toBe("loaded");
    // The second's returns only held rows, a full page of them, so it retries
    // on the strict cursor and gets past the burst.
    const again = await readOlderPage(queryClient, CHANNEL, fetchPage);
    expect(again).toEqual({ outcome: "loaded", start: "oldm1" });
    expect(queries.at(-1)?.before).toBe(instant);
  });

  test("refuses a page whose action read was incomplete, merging nothing", async () => {
    const { fetchPage } = fakeServer(rows(1, 150));
    await openChannel(fetchPage);
    const before = queryClient.getQueryData<ChannelCache>(KEY);
    await expect(
      readOlderPage(queryClient, CHANNEL, async (id, q) => ({
        ...(await fetchPage(id, q)),
        actionsIncomplete: true,
      })),
    ).rejects.toBeInstanceOf(IncompleteActionsError);
    expect(queryClient.getQueryData<ChannelCache>(KEY)).toBe(before);
  });

  test("keeps a row that landed in the cache while the read was in flight", async () => {
    const { fetchPage } = fakeServer(rows(1, 150));
    await openChannel(fetchPage);
    const duringRead: FetchHistoryPage = async (id, query) => {
      // A Realtime arrival: newer than everything, so the edge stays put.
      queryClient.setQueryData<ChannelCache>(KEY, (current) =>
        mergeServerRow(current!, row(900)),
      );
      return fetchPage(id, query);
    };

    const read = await readOlderPage(queryClient, CHANNEL, duringRead);

    expect(read.outcome).toBe("loaded");
    const held = ids(queryClient.getQueryData<ChannelCache>(KEY));
    expect(held).toContain("m900");
    expect(held.at(-1)).toBe("m900");
    expect(held[0]).toBe("m2");
  });

  test("says the start without a read when nothing is confirmed yet", async () => {
    const fetchPage = vi.fn<FetchHistoryPage>();
    expect(await readOlderPage(queryClient, CHANNEL, fetchPage)).toEqual({
      outcome: "start",
      start: null,
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  test("rejects when the read fails, leaving the cache as it was", async () => {
    const { fetchPage } = fakeServer(rows(1, 150));
    await openChannel(fetchPage);
    const before = queryClient.getQueryData<ChannelCache>(KEY);
    await expect(
      readOlderPage(queryClient, CHANNEL, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(queryClient.getQueryData<ChannelCache>(KEY)).toBe(before);
  });
});

describe("hasOlderHistory", () => {
  const cache = mergeServerRows(emptyCache(), rows(10, 20));

  test("is 'maybe' until a read recorded the start", () => {
    expect(hasOlderHistory(undefined, undefined)).toBe(false);
    expect(hasOlderHistory(cache, undefined)).toBe(true);
  });

  test("is false while the oldest row is the recorded start, and true once it moves", () => {
    expect(hasOlderHistory(cache, "m10")).toBe(false);
    expect(hasOlderHistory(cache, "m1")).toBe(true);
    expect(hasOlderHistory(emptyCache(), null)).toBe(false);
  });
});

describe("olderHistoryView", () => {
  const cache = mergeServerRows(emptyCache(), rows(10, 20));
  const idle = { starts: new Map(), older: new Map() } as const;

  test("with no channel open, says nothing is older, loading or failed", () => {
    expect(
      olderHistoryView(
        { starts: new Map([["c1", "m1"]]), older: new Map([["c1", "error"]]) },
        null,
        cache,
      ),
    ).toEqual({ hasOlder: false, isLoadingOlder: false, olderError: false });
  });

  test("reads hasOlder off the cache and the recorded start", () => {
    expect(olderHistoryView(idle, "c1", cache).hasOlder).toBe(true);
    expect(
      olderHistoryView(
        { starts: new Map([["c1", "m10"]]), older: new Map() },
        "c1",
        cache,
      ).hasOlder,
    ).toBe(false);
    expect(olderHistoryView(idle, "c1", undefined).hasOlder).toBe(false);
  });

  test("reports only this channel's read status", () => {
    const state = {
      starts: new Map(),
      older: new Map<string, "loading" | "error">([
        ["c1", "loading"],
        ["c2", "error"],
      ]),
    };
    expect(olderHistoryView(state, "c1", cache)).toMatchObject({
      isLoadingOlder: true,
      olderError: false,
    });
    expect(olderHistoryView(state, "c2", cache)).toMatchObject({
      isLoadingOlder: false,
      olderError: true,
    });
    expect(olderHistoryView(state, "c3", cache)).toMatchObject({
      isLoadingOlder: false,
      olderError: false,
    });
  });
});

describe("createHistoryPageFetcher", () => {
  /**
   * `from().select().in().order().range()`, answering each range from
   * `store` with PostgREST's shape: at most `cap` rows, and the exact count.
   */
  function clients(
    data: unknown,
    error?: unknown,
    store: RawChatMessageAction[] = [reaction("a1", "m1")],
    cap = ACTION_READ_LIMIT,
  ) {
    const GET = vi.fn().mockResolvedValue({ data, error });
    const range = vi.fn(async (from: number, to: number) => ({
      data: store.slice(from, Math.min(to + 1, from + cap)),
      error: null,
      count: store.length,
    }));
    const inFn = vi.fn(() => ({ order: () => ({ range }) }));
    const supabase = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ in: inFn })) })),
    };
    return { GET, inFn, range, supabase };
  }

  const manyActions = (n: number) =>
    Array.from({ length: n }, (_, i) => reaction(`a${i}`, "m1"));

  test("reads the page, then its actions in one batched select", async () => {
    const { GET, inFn, range, supabase } = clients(rows(1, 2));
    const fetchPage = createHistoryPageFetcher(
      { GET } as never,
      supabase as never,
    );
    const page = await fetchPage(CHANNEL, { limit: 100, before: "x" });
    expect(GET).toHaveBeenCalledWith("/v1/channels/{id}/messages", {
      params: { path: { id: CHANNEL }, query: { limit: 100, before: "x" } },
    });
    expect(inFn).toHaveBeenCalledWith("message_id", ["m1", "m2"]);
    expect(range).toHaveBeenCalledTimes(1);
    expect(page).toEqual({ rows: rows(1, 2), actions: [reaction("a1", "m1")] });
  });

  test("pages the action read past PostgREST's row cap, by the exact count", async () => {
    const { GET, range, supabase } = clients(
      rows(1, 2),
      undefined,
      manyActions(1500),
    );
    const page = await createHistoryPageFetcher(
      { GET } as never,
      supabase as never,
    )(CHANNEL, { limit: 100 });
    expect(page.actions).toHaveLength(1500);
    expect(page.actionsIncomplete).toBeUndefined();
    expect(range.mock.calls).toEqual([
      [0, ACTION_READ_LIMIT - 1],
      [1000, 1000 + ACTION_READ_LIMIT - 1],
    ]);
  });

  test("keeps paging when the server's cap is lower than the read limit", async () => {
    const { GET, supabase } = clients(
      rows(1, 2),
      undefined,
      manyActions(1200),
      500,
    );
    const page = await createHistoryPageFetcher(
      { GET } as never,
      supabase as never,
    )(CHANNEL, { limit: 100 });
    expect(page.actions).toHaveLength(1200);
  });

  test("flags a failed action read instead of rejecting", async () => {
    const { GET, range, supabase } = clients(rows(1, 2));
    range.mockResolvedValue({
      data: null,
      error: { message: "JWT expired" },
      count: null,
    } as never);
    const page = await createHistoryPageFetcher(
      { GET } as never,
      supabase as never,
    )(CHANNEL, { limit: 50 });
    expect(page).toEqual({
      rows: rows(1, 2),
      actions: [],
      actionsIncomplete: true,
    });
  });

  test("paints without actions when there is no Supabase client", async () => {
    const { GET } = clients(rows(1, 2));
    const page = await createHistoryPageFetcher({ GET } as never, null)(
      CHANNEL,
      { limit: 50 },
    );
    expect(page).toEqual({ rows: rows(1, 2), actions: [] });
  });

  test("rejects when the message read fails", async () => {
    const { GET, supabase } = clients(undefined, new Error("403"));
    await expect(
      createHistoryPageFetcher({ GET } as never, supabase as never)(CHANNEL, {
        limit: 50,
      }),
    ).rejects.toThrow("403");
  });
});

describe("createHistoryPager", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  test("records where each channel's history starts, from a short read", async () => {
    const pager = createHistoryPager(
      queryClient,
      fakeServer(rows(1, 7)).fetchPage,
    );
    const cache = await pager.readNewest(CHANNEL);
    queryClient.setQueryData(KEY, cache);
    expect(pager.getSnapshot().starts.get(CHANNEL)).toBe("m1");
    expect(
      hasOlderHistory(cache, pager.getSnapshot().starts.get(CHANNEL)),
    ).toBe(false);
  });

  test("moves an older read through loading, and to the start once it comes back short", async () => {
    const server = fakeServer(rows(1, 120));
    const pager = createHistoryPager(queryClient, server.fetchPage);
    queryClient.setQueryData(KEY, await pager.readNewest(CHANNEL));
    const seen: string[] = [];
    pager.subscribe(() => {
      seen.push(pager.getSnapshot().older.get(CHANNEL) ?? "idle");
    });

    expect(await pager.loadOlder(CHANNEL)).toBe("loaded");

    // Loading first; idle once it settled (recording the start notifies too).
    expect(seen[0]).toBe("loading");
    expect(seen.at(-1)).toBe("idle");
    expect(pager.getSnapshot().starts.get(CHANNEL)).toBe("m1");
  });

  test("shares one read between concurrent calls for a channel", async () => {
    const fetchPage = vi.fn(fakeServer(rows(1, 150)).fetchPage);
    const pager = createHistoryPager(queryClient, fetchPage);
    queryClient.setQueryData(KEY, await pager.readNewest(CHANNEL));

    const first = pager.loadOlder(CHANNEL);
    const second = pager.loadOlder(CHANNEL);

    expect(first).toBe(second);
    await first;
    // The newest page, then one older read.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  test("keeps a failure on its own channel when it settles after a switch", async () => {
    const OTHER = "c2";
    const failing = deferred<never>();
    const pending = deferred<{ rows: RawChatMessage[]; actions: never[] }>();
    const fetchPage: FetchHistoryPage = (id) =>
      id === CHANNEL ? failing.promise : pending.promise;
    const pager = createHistoryPager(queryClient, fetchPage);
    queryClient.setQueryData(
      KEY,
      mergeServerRows(emptyCache(), rows(101, 150)),
    );
    queryClient.setQueryData(
      chatMessagesKey(OTHER),
      mergeServerRows(
        emptyCache(),
        rows(101, 150).map((r) => ({
          ...r,
          id: `o${r.id}`,
          channel_id: OTHER,
        })),
      ),
    );

    const first = pager.loadOlder(CHANNEL);
    void pager.loadOlder(OTHER);
    failing.reject(new Error("offline"));
    expect(await first).toBe("error");

    expect(pager.getSnapshot().older.get(CHANNEL)).toBe("error");
    expect(pager.getSnapshot().older.get(OTHER)).toBe("loading");
    pending.resolve({ rows: [], actions: [] });
  });

  test("clears a failure on the next attempt", async () => {
    let fail = true;
    const { fetchPage } = fakeServer(rows(1, 150));
    const pager = createHistoryPager(queryClient, async (id, query) => {
      if (fail) throw new Error("offline");
      return fetchPage(id, query);
    });
    queryClient.setQueryData(
      KEY,
      mergeServerRows(emptyCache(), rows(101, 150)),
    );

    expect(await pager.loadOlder(CHANNEL)).toBe("error");
    expect(pager.getSnapshot().older.get(CHANNEL)).toBe("error");
    fail = false;
    expect(await pager.loadOlder(CHANNEL)).toBe("loaded");
    expect(pager.getSnapshot().older.has(CHANNEL)).toBe(false);
  });
});
