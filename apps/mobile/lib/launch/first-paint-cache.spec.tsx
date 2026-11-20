/** @vitest-environment jsdom */
/**
 * #5768: a cold launch paints chat from what the phone kept, and only ever
 * the signed-in member's own copy for the chapter they're in.
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyCache,
  mergeServerRows,
  upsertOptimistic,
} from "@repo/chat-core/cache";
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

import {
  FIRST_PAINT_FORMAT,
  FIRST_PAINT_MAX_AGE_MS,
  TAIL_CHANNEL_LIMIT,
  TAIL_MESSAGE_LIMIT,
  firstPaintKey,
  forgetFirstPaint,
  readFirstPaint,
  seedFirstPaint,
  toCacheableRows,
  withTail,
} from "./first-paint-cache";
import {
  TAIL_WRITE_TIMING,
  useFirstPaintCacheRuntime,
} from "./use-first-paint-cache-runtime";

const store = new Map<string, string>();
const storage = vi.mocked(AsyncStorage) as unknown as {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  getAllKeys: ReturnType<typeof vi.fn>;
  multiGet: ReturnType<typeof vi.fn>;
  multiRemove?: ReturnType<typeof vi.fn>;
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

function put(
  part: string,
  value: unknown,
  user = "auth-1",
  chapter: string | null = "chapter-1",
) {
  store.set(firstPaintKey(user, chapter, part as "me"), JSON.stringify(value));
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
  storage.getAllKeys.mockImplementation(async () => [...store.keys()]);
  storage.multiGet.mockImplementation(async (keys: string[]) =>
    keys.map((key) => [key, store.get(key) ?? null]),
  );
  storage.multiRemove = vi.fn(async (keys: string[]) => {
    for (const key of keys) store.delete(key);
  });
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

  it("keeps a token that names no chapter under its own scope", async () => {
    put("me", answer({ id: "user-row-1" }), "auth-1", null);

    expect((await readFirstPaint("auth-1", null)).me?.data).toEqual({
      id: "user-row-1",
    });
    expect((await readFirstPaint("auth-1", "chapter-1")).me).toBeNull();
  });

  it("ignores a copy past its age, in another format, or unreadable", async () => {
    put("me", answer({ id: "u" }, Date.now() - FIRST_PAINT_MAX_AGE_MS - 1));
    put("channels", {
      format: FIRST_PAINT_FORMAT + 1,
      cachedAt: Date.now(),
      data: [],
    });
    store.set(firstPaintKey("auth-1", "chapter-1", "blocks"), "{not json");

    const kept = await readFirstPaint("auth-1", "chapter-1");

    expect(kept).toEqual({ me: null, channels: null, blocks: null, tails: [] });
  });

  it("reads as nothing when storage fails", async () => {
    storage.multiGet.mockRejectedValueOnce(new Error("disk"));
    expect(await readFirstPaint("auth-1", "chapter-1")).toEqual({
      me: null,
      channels: null,
      blocks: null,
      tails: [],
    });
  });
});

describe("tails", () => {
  it("keeps the newest confirmed rows only", () => {
    let cache = mergeServerRows(
      emptyCache(),
      Array.from({ length: TAIL_MESSAGE_LIMIT + 5 }, (_, i) =>
        row(`m${i}`, "c1", i),
      ),
    );
    cache = upsertOptimistic(cache, {
      ...cache.byId.m0!,
      id: "pending-1",
      client_message_id: "pending-1",
      _status: "pending",
    } as never);
    const rows = toCacheableRows(cache.order.map((key) => cache.byId[key]!));
    expect(rows).toHaveLength(TAIL_MESSAGE_LIMIT);
    expect(rows.map((r) => r.id)).not.toContain("pending-1");
    expect(rows.at(-1)?.id).toBe(`m${TAIL_MESSAGE_LIMIT + 4}`);
  });

  it("puts the channel loaded last first and keeps a few", () => {
    let tails = [] as ReturnType<typeof withTail>;
    for (const id of ["a", "b", "c", "d", "b"]) {
      tails = withTail(tails, { channelId: id, rows: [], cachedAt: 1 });
    }
    expect(tails.map((t) => t.channelId)).toEqual(["b", "d", "c"]);
    expect(tails).toHaveLength(TAIL_CHANNEL_LIMIT);
  });
});

describe("seedFirstPaint", () => {
  it("fills empty keys with the copy's own age and marks them stale", () => {
    const client = new QueryClient();
    const cachedAt = Date.now() - 60_000;
    seedFirstPaint(client, "chapter-1", {
      me: answer({ id: "user-row-1" }, cachedAt),
      channels: answer([{ id: "c1" }], cachedAt),
      blocks: answer({ ids: ["blocked-1"] }, cachedAt),
      tails: [{ channelId: "c1", cachedAt, rows: [row("m1")] }],
    });

    expect(client.getQueryData(["user", "me"])).toEqual({ id: "user-row-1" });
    expect(client.getQueryState(CHANNEL_LIST_KEY)?.dataUpdatedAt).toBe(
      cachedAt,
    );
    expect(client.getQueryState(CHANNEL_LIST_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryData(chatBlockKeys.list("chapter-1"))).toEqual({
      ids: ["blocked-1"],
      readSeq: 0,
    });
    const tail = client.getQueryData<ChannelCache>(chatMessagesKey("c1"));
    expect(Object.keys(tail?.byId ?? {})).toEqual(["m1"]);
  });

  it("never replaces what the server already answered", () => {
    const client = new QueryClient();
    client.setQueryData(CHANNEL_LIST_KEY, [{ id: "live" }]);
    client.setQueryData(
      chatMessagesKey("c1"),
      mergeServerRows(emptyCache(), [row("live")]),
    );

    seedFirstPaint(client, "chapter-1", {
      me: null,
      channels: answer([{ id: "kept" }]),
      blocks: null,
      tails: [{ channelId: "c1", cachedAt: Date.now(), rows: [row("kept")] }],
    });

    expect(client.getQueryData(CHANNEL_LIST_KEY)).toEqual([{ id: "live" }]);
    const tail = client.getQueryData<ChannelCache>(chatMessagesKey("c1"));
    expect(Object.keys(tail?.byId ?? {})).toEqual(["live"]);
  });

  it("doesn't cancel a fetch already on its way", async () => {
    const client = new QueryClient();
    let resolve: (value: unknown) => void = () => {};
    const queryFn = vi.fn(() => new Promise((r) => (resolve = r)));
    const observerFetch = client.fetchQuery({
      queryKey: CHANNEL_LIST_KEY,
      queryFn,
    });

    seedFirstPaint(client, "chapter-1", {
      me: null,
      channels: answer([{ id: "kept" }]),
      blocks: null,
      tails: [],
    });
    resolve([{ id: "live" }]);
    await observerFetch;

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(CHANNEL_LIST_KEY)).toEqual([{ id: "live" }]);
  });
});

describe("forgetFirstPaint", () => {
  it("drops every member's copy and nothing else", async () => {
    put("me", answer({ id: "u" }));
    put("me", answer({ id: "v" }), "auth-2");
    store.set("frapp.chat.unread.auth-1.chapter-1", "[]");

    forgetFirstPaint();
    await settled();

    expect([...store.keys()]).toEqual(["frapp.chat.unread.auth-1.chapter-1"]);
  });
});

describe("useFirstPaintCacheRuntime", () => {
  function mount(client: QueryClient) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useFirstPaintCacheRuntime(), { wrapper });
  }

  it("seeds the launch from the kept copy", async () => {
    put("channels", answer([{ id: "c1" }]));
    put("me", answer({ id: "user-row-1" }));
    const client = new QueryClient();

    mount(client);
    await act(settled);

    expect(client.getQueryData(CHANNEL_LIST_KEY)).toEqual([{ id: "c1" }]);
    expect(client.getQueryData(["user", "me"])).toEqual({ id: "user-row-1" });
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
        queryKey: chatBlockKeys.list("chapter-1"),
        queryFn: async () => ({ ids: ["blocked-1"], readSeq: 3 }),
      });
    });

    const kept = await readFirstPaint("auth-1", "chapter-1");
    expect(kept.channels?.data).toEqual([{ id: "live" }]);
    expect(kept.blocks?.data).toEqual({ ids: ["blocked-1"] });
  });

  it("never files a seed, or an answer fetched before this scope, under it", async () => {
    const client = new QueryClient();
    // Fetched before the scope: the outgoing member's answer, still cached
    // for a moment before the clear.
    await client.fetchQuery({
      queryKey: CHANNEL_LIST_KEY,
      queryFn: async () => [{ id: "outgoing" }],
    });
    mount(client);
    await act(settled);

    await act(async () => {
      client.setQueryData(CHANNEL_LIST_KEY, [{ id: "written by hand" }]);
      await settled();
    });

    expect(store.has(firstPaintKey("auth-1", "chapter-1", "channels"))).toBe(
      false,
    );
  });

  it("writes a timeline's tail once it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = new QueryClient();
    mount(client);
    await act(settled);

    await act(async () => {
      await client.fetchQuery({
        queryKey: chatMessagesKey("c1"),
        queryFn: async () => mergeServerRows(emptyCache(), [row("m1")]),
      });
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
  });
});
