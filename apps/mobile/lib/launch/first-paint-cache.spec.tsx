/** @vitest-environment jsdom */
/**
 * #5768: a cold launch paints chat from what the phone kept, and only ever
 * the signed-in member's own copy for the chapter they're in.
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCache, mergeServerRows } from "@repo/chat-core/cache";
import {
  FIRST_CHUNK_CHANNEL_LIMIT,
  FIRST_CHUNK_MAX_AGE_MS,
  TAIL_ROW_FORMAT,
} from "@repo/chat-core/first-chunk";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";
import { CHANNEL_LIST_KEY, chatBlockKeys } from "@repo/hooks";

const session = vi.hoisted(() => ({
  value: {
    status: "authenticated" as string,
    userId: "auth-1" as string | null,
    chapterId: "chapter-1" as string | null,
    isChapterResolving: false,
  },
}));
vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => session.value,
}));

/** The keychain: the session's chunked SecureStore adapter, in memory. */
const keychain = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/supabase", () => ({
  sessionStorageAdapter: {
    getItem: async (key: string) => keychain.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      keychain.set(key, value);
    },
    removeItem: async (key: string) => {
      keychain.delete(key);
    },
  },
}));

import {
  FIRST_PAINT_FORMAT,
  ME_KEY,
  firstPaintGeneration,
  firstPaintKey,
  forgetFirstPaint,
  readFirstPaint,
  seedFirstPaint,
  withTail,
  withoutTail,
  writeKeptChannels,
  type FirstPaint,
  type KeptTail,
} from "./first-paint-cache";
import { useKeptBlockFloor } from "./kept-block-floor";
import {
  TAIL_WRITE_TIMING,
  useFirstPaintCacheRuntime,
} from "./use-first-paint-cache-runtime";

const store = new Map<string, string>();
const storage = vi.mocked(AsyncStorage) as unknown as {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  getAllKeys: ReturnType<typeof vi.fn>;
  multiGet: ReturnType<typeof vi.fn>;
};

const NOTHING: FirstPaint = {
  me: null,
  channels: null,
  blockFloor: null,
  tails: [],
};

function row(id: string, channelId = "c1", minute = 0): RawChatMessage {
  return {
    id,
    channel_id: channelId,
    sender_id: "user-row-1",
    content: `message ${id}`,
    kind: "text",
    created_at: new Date(Date.UTC(2026, 10, 20, 12, minute)).toISOString(),
  } as RawChatMessage;
}

function tail(channelId: string, rows: RawChatMessage[] = []): KeptTail {
  return {
    channelId,
    rows,
    cachedAt: Date.now() - 60_000,
    rowFormat: TAIL_ROW_FORMAT,
  };
}

function put(
  part: "channels" | "blocks" | "tails",
  value: unknown,
  user = "auth-1",
  chapter: string | null = "chapter-1",
) {
  store.set(firstPaintKey(user, chapter, part), JSON.stringify(value));
}

function putMe(data: object, authUid = "auth-1", cachedAt = Date.now()) {
  keychain.set(
    ME_KEY,
    JSON.stringify({ format: FIRST_PAINT_FORMAT, authUid, cachedAt, data }),
  );
}

function answer<T>(data: T, cachedAt = Date.now() - 60_000) {
  return { format: FIRST_PAINT_FORMAT, cachedAt, data };
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  keychain.clear();
  session.value = {
    status: "authenticated",
    userId: "auth-1",
    chapterId: "chapter-1",
    isChapterResolving: false,
  };
  storage.getItem.mockImplementation(
    async (key: string) => store.get(key) ?? null,
  );
  storage.setItem.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  storage.removeItem.mockImplementation(async (key: string) => {
    store.delete(key);
  });
  storage.getAllKeys.mockImplementation(async () => [...store.keys()]);
  storage.multiGet.mockImplementation(async (keys: string[]) =>
    keys.map((key) => [key, store.get(key) ?? null]),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readFirstPaint", () => {
  it("reads only the signed-in member's copy for this chapter", async () => {
    put("channels", answer([{ id: "mine" }]));
    put("channels", answer([{ id: "other member" }]), "auth-2");
    put("channels", answer([{ id: "other chapter" }]), "auth-1", "chapter-2");

    const kept = await readFirstPaint("auth-1", "chapter-1");

    expect(kept.channels?.data).toEqual([{ id: "mine" }]);
  });

  it("keeps the profile in the keychain, for its own member only", async () => {
    putMe({ id: "user-row-1" });

    expect((await readFirstPaint("auth-1", null)).me?.data).toEqual({
      id: "user-row-1",
    });
    expect((await readFirstPaint("auth-2", null)).me).toBeNull();
    expect([...store.keys()].some((key) => key.endsWith(".me"))).toBe(false);
  });

  it("ignores a copy past its age, in another format, or unreadable", async () => {
    putMe({ id: "u" }, "auth-1", Date.now() - FIRST_CHUNK_MAX_AGE_MS - 1);
    put("channels", {
      format: FIRST_PAINT_FORMAT + 1,
      cachedAt: Date.now(),
      data: [],
    });
    store.set(firstPaintKey("auth-1", "chapter-1", "blocks"), "{not json");
    put("tails", {
      format: FIRST_PAINT_FORMAT,
      tails: [{ ...tail("c1"), rowFormat: TAIL_ROW_FORMAT - 1 }],
    });

    expect(await readFirstPaint("auth-1", "chapter-1")).toEqual(NOTHING);
  });

  it("keeps the block floor however old it is", async () => {
    put("blocks", { format: FIRST_PAINT_FORMAT, ids: ["blocked-1"] });

    expect(
      (await readFirstPaint("auth-1", "chapter-1", Date.now() + 365 * 864e5))
        .blockFloor,
    ).toEqual(["blocked-1"]);
  });

  it("reads as nothing when storage fails", async () => {
    storage.multiGet.mockRejectedValueOnce(new Error("disk"));
    expect(await readFirstPaint("auth-1", "chapter-1")).toEqual(NOTHING);
  });
});

describe("tails", () => {
  it("puts the channel loaded last first and keeps a few", () => {
    let tails: KeptTail[] = [];
    for (const id of ["a", "b", "c", "d", "b"])
      tails = withTail(tails, tail(id));
    expect(tails.map((t) => t.channelId)).toEqual(["b", "d", "c"]);
    expect(tails).toHaveLength(FIRST_CHUNK_CHANNEL_LIMIT);
    expect(withoutTail(tails, "d").map((t) => t.channelId)).toEqual(["b", "c"]);
  });
});

describe("seedFirstPaint", () => {
  it("fills empty keys with the copy's own age and marks them stale", () => {
    const client = new QueryClient();
    const cachedAt = Date.now() - 60_000;
    seedFirstPaint(client, {
      me: answer({ id: "user-row-1" }, cachedAt),
      channels: answer([{ id: "c1" }], cachedAt),
      blockFloor: ["blocked-1"],
      tails: [{ ...tail("c1", [row("m1")]), cachedAt }],
    });

    expect(client.getQueryData(["user", "me"])).toEqual({ id: "user-row-1" });
    expect(client.getQueryState(CHANNEL_LIST_KEY)?.dataUpdatedAt).toBe(
      cachedAt,
    );
    expect(client.getQueryState(CHANNEL_LIST_KEY)?.isInvalidated).toBe(true);
    const seeded = client.getQueryData<ChannelCache>(chatMessagesKey("c1"));
    expect(Object.keys(seeded?.byId ?? {})).toEqual(["m1"]);
  });

  it("never seeds the block list, which would read as a ready list nobody read", () => {
    const client = new QueryClient();
    seedFirstPaint(client, { ...NOTHING, blockFloor: ["blocked-1"] });
    expect(
      client.getQueryData(chatBlockKeys.list("chapter-1")),
    ).toBeUndefined();
  });

  it("never replaces what the server already answered", () => {
    const client = new QueryClient();
    client.setQueryData(CHANNEL_LIST_KEY, [{ id: "live" }]);
    client.setQueryData(
      chatMessagesKey("c1"),
      mergeServerRows(emptyCache(), [row("live")]),
    );

    seedFirstPaint(client, {
      ...NOTHING,
      channels: answer([{ id: "kept" }]),
      tails: [tail("c1", [row("kept")])],
    });

    expect(client.getQueryData(CHANNEL_LIST_KEY)).toEqual([{ id: "live" }]);
    const kept = client.getQueryData<ChannelCache>(chatMessagesKey("c1"));
    expect(Object.keys(kept?.byId ?? {})).toEqual(["live"]);
  });

  it("doesn't cancel a fetch already on its way", async () => {
    const client = new QueryClient();
    let resolve: (value: unknown) => void = () => {};
    const queryFn = vi.fn(() => new Promise((r) => (resolve = r)));
    const observerFetch = client.fetchQuery({
      queryKey: CHANNEL_LIST_KEY,
      queryFn,
    });

    seedFirstPaint(client, { ...NOTHING, channels: answer([{ id: "kept" }]) });
    resolve([{ id: "live" }]);
    await observerFetch;

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(CHANNEL_LIST_KEY)).toEqual([{ id: "live" }]);
  });
});

describe("forgetFirstPaint", () => {
  it("drops every member's copy, the keychain's included, and nothing else", async () => {
    putMe({ id: "u" });
    put("channels", answer([]));
    put("channels", answer([]), "auth-2");
    store.set("frapp.chat.unread.auth-1.chapter-1", "[]");

    forgetFirstPaint();
    await settled();

    expect(keychain.size).toBe(0);
    expect([...store.keys()]).toEqual(["frapp.chat.unread.auth-1.chapter-1"]);
  });

  it("drops a write the outgoing scope still had pending", async () => {
    const generation = firstPaintGeneration();
    forgetFirstPaint();
    await settled();

    writeKeptChannels(generation, "auth-1", "chapter-1", [{ id: "c1" }], 1);
    await settled();

    expect(store.size).toBe(0);
  });

  it("runs with every sign-out and account swap", async () => {
    const { clearProductQueryCache } = await import("@/lib/query-client");
    putMe({ id: "u" });

    clearProductQueryCache();
    await settled();

    expect(keychain.size).toBe(0);
  });
});

describe("useFirstPaintCacheRuntime", () => {
  function mount(client: QueryClient) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(
      () => {
        useFirstPaintCacheRuntime();
        return useKeptBlockFloor();
      },
      { wrapper },
    );
  }

  /** A timeline on screen: an observer, as the thread's `useQuery` is. */
  function watch(
    client: QueryClient,
    channelId: string,
    rows: RawChatMessage[],
  ) {
    const observer = new QueryObserver(client, {
      queryKey: chatMessagesKey(channelId),
      queryFn: async () => mergeServerRows(emptyCache(), rows),
    });
    return observer.subscribe(() => undefined);
  }

  async function writesSettle() {
    await act(async () => {
      vi.advanceTimersByTime(TAIL_WRITE_TIMING.maxWaitMs);
      await settled();
    });
  }

  it("seeds the launch from the kept copy and holds the block floor", async () => {
    put("channels", answer([{ id: "c1" }]));
    put("blocks", { format: FIRST_PAINT_FORMAT, ids: ["blocked-1"] });
    putMe({ id: "user-row-1" });
    const client = new QueryClient();

    const { result, unmount } = mount(client);
    await act(settled);

    expect(client.getQueryData(CHANNEL_LIST_KEY)).toEqual([{ id: "c1" }]);
    expect(client.getQueryData(["user", "me"])).toEqual({ id: "user-row-1" });
    expect([...result.current]).toEqual(["blocked-1"]);

    // The scope ending (a sign-out, a chapter switch) lets the floor go.
    const floor = renderHook(() => useKeptBlockFloor());
    unmount();
    expect(floor.result.current.size).toBe(0);
  });

  it("waits for a session before reading anything", async () => {
    session.value = { ...session.value, status: "hydrating", userId: null };
    put("channels", answer([{ id: "c1" }]));
    const client = new QueryClient();

    mount(client);
    await act(settled);

    expect(storage.multiGet).not.toHaveBeenCalled();
    expect(client.getQueryData(CHANNEL_LIST_KEY)).toBeUndefined();
  });

  it("waits while the chapter is still being settled", async () => {
    session.value = { ...session.value, isChapterResolving: true };
    mount(new QueryClient());
    await act(settled);
    expect(storage.multiGet).not.toHaveBeenCalled();
  });

  it("keeps what the server answers under this scope", async () => {
    const client = new QueryClient();
    mount(client);
    await act(settled);

    await act(async () => {
      await client.fetchQuery({
        queryKey: CHANNEL_LIST_KEY,
        queryFn: async () => [{ id: "live" }],
      });
      await client.fetchQuery({
        queryKey: ["user", "me"],
        queryFn: async () => ({ id: "user-row-1" }),
      });
      await client.fetchQuery({
        queryKey: chatBlockKeys.list("chapter-1"),
        queryFn: async () => ({ ids: ["blocked-1"], readSeq: 3 }),
      });
      await settled();
    });

    const kept = await readFirstPaint("auth-1", "chapter-1");
    expect(kept.channels?.data).toEqual([{ id: "live" }]);
    expect(kept.me?.data).toEqual({ id: "user-row-1" });
    expect(kept.blockFloor).toEqual(["blocked-1"]);
  });

  it("never files an answer fetched before this scope under it", async () => {
    const client = new QueryClient();
    // Started before the scope: the outgoing member's read, answering just
    // after the new scope begins and before the cache is cleared.
    let resolve: (value: unknown) => void = () => {};
    const outgoing = client.fetchQuery({
      queryKey: CHANNEL_LIST_KEY,
      queryFn: () => new Promise((r) => (resolve = r)),
    });
    mount(client);
    await act(settled);

    await act(async () => {
      resolve([{ id: "outgoing" }]);
      await outgoing;
      await settled();
    });

    expect(store.has(firstPaintKey("auth-1", "chapter-1", "channels"))).toBe(
      false,
    );
  });

  it("never writes a seed back as if it were fresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const keptAt = Date.now() - 60_000;
    put("tails", {
      format: FIRST_PAINT_FORMAT,
      tails: [{ ...tail("c1", [row("m1")]), cachedAt: keptAt }],
    });
    const client = new QueryClient();
    mount(client);
    // The thread mounts before the disk answers, its fetch hangs, and the
    // seed lands on it meanwhile.
    const observer = new QueryObserver(client, {
      queryKey: chatMessagesKey("c1"),
      queryFn: () => new Promise<ChannelCache>(() => undefined),
    });
    const stop = observer.subscribe(() => undefined);
    await act(settled);
    expect(
      client.getQueryData<ChannelCache>(chatMessagesKey("c1"))?.byId.m1,
    ).toBeDefined();
    await writesSettle();

    const kept = await readFirstPaint("auth-1", "chapter-1");
    expect(kept.tails[0]?.cachedAt).toBe(keptAt);
    stop();
  });

  it("writes a timeline on screen once it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = new QueryClient();
    mount(client);
    await act(settled);

    let stop = () => {};
    await act(async () => {
      stop = watch(client, "c1", [row("m1")]);
      await settled();
    });
    expect(store.has(firstPaintKey("auth-1", "chapter-1", "tails"))).toBe(
      false,
    );

    await act(async () => {
      vi.advanceTimersByTime(TAIL_WRITE_TIMING.debounceMs);
      await settled();
    });

    const kept = await readFirstPaint("auth-1", "chapter-1");
    expect(kept.tails.map((t) => t.channelId)).toEqual(["c1"]);
    expect(kept.tails[0]?.rows.map((r) => r.id)).toEqual(["m1"]);
    stop();
  });

  it("doesn't let a read-ahead push out the channel the member opened", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = new QueryClient();
    mount(client);
    await act(settled);

    await act(async () => {
      await client.prefetchQuery({
        queryKey: chatMessagesKey("ahead"),
        queryFn: async () =>
          mergeServerRows(emptyCache(), [row("a1", "ahead")]),
      });
      await settled();
    });
    await writesSettle();

    const kept = await readFirstPaint("auth-1", "chapter-1");
    expect(kept.tails).toEqual([]);
  });

  it("forgets a timeline the member can no longer read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    put("tails", {
      format: FIRST_PAINT_FORMAT,
      tails: [tail("gone", [row("g1", "gone")])],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mount(client);
    await act(settled);

    await act(async () => {
      await client
        .fetchQuery({
          queryKey: chatMessagesKey("gone"),
          queryFn: async () => {
            throw Object.assign(new Error("gone"), { statusCode: 404 });
          },
        })
        .catch(() => undefined);
      await settled();
    });
    await writesSettle();

    const kept = await readFirstPaint("auth-1", "chapter-1");
    expect(kept.tails).toEqual([]);
  });
});
