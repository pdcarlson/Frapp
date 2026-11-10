/** @vitest-environment jsdom */
/**
 * #4006: the unread marks must not wait on `GET /v1/channels/unread`, and the
 * server's answer must replace whatever was shown before it.
 *
 * Every test holds that request pending and reads what chat home reads: the
 * real `useChannelUnreadCounts` through `sidebarUnreadCounts`.
 */
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_UNREAD_COUNTS_KEY,
  FrappClientProvider,
  claimViewedChannel,
  sidebarUnreadCounts,
  useChannelUnreadCounts,
  type ChannelUnreadCount,
} from "@repo/hooks";

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

const tray = vi.hoisted(() => ({
  channelIds: [] as string[],
  /** Set to hold the tray read until the test lets it go. */
  held: null as Promise<void> | null,
}));
vi.mock("@/lib/notifications/push", () => ({
  presentedChatChannelIds: async () => {
    await tray.held;
    return new Set(tray.channelIds);
  },
}));

const appState = vi.hoisted(() => ({
  currentState: "active" as string,
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
}));
function setAppState(next: string) {
  appState.currentState = next;
  for (const listener of [...appState.listeners]) listener(next);
}
/** Back from the background, with the tray read and its write settled. */
function foreground(from = "background") {
  return act(async () => {
    setAppState(from);
    setAppState("active");
    await settled();
  });
}

import {
  lightChannels,
  parseUnreadMemory,
  unreadMemoryKey,
  useUnreadFirstPaintRuntime,
} from "./unread-first-paint";

const storage = vi.mocked(AsyncStorage);

function row(
  channel_id: string,
  unread_count = 0,
  mention_count = 0,
): ChannelUnreadCount {
  return { channel_id, unread_count, mention_count };
}

/**
 * TanStack notifies its observers on a timer it sets after the promise chain
 * has run, so one turn of the timer queue isn't enough: the second is queued
 * behind that notification.
 */
async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The API, with each `GET /v1/channels/unread` held until the test answers. */
function heldApi() {
  const pending: ((rows: ChannelUnreadCount[]) => void)[] = [];
  const fail: ((error: unknown) => void)[] = [];
  const client = {
    GET: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          pending.push((rows) => resolve({ data: rows, error: undefined }));
          fail.push(reject);
        }),
    ),
  };
  return {
    client,
    requests: () => client.GET.mock.calls.length,
    answer: (rows: ChannelUnreadCount[]) =>
      act(async () => {
        pending.shift()?.(rows);
        await settled();
      }),
    reject: () =>
      act(async () => {
        fail.shift()?.(new Error("down"));
        await settled();
      }),
  };
}

function mount(api: ReturnType<typeof heldApi>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <FrappClientProvider client={api.client as never}>
        {children}
      </FrappClientProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () => {
      useUnreadFirstPaintRuntime();
      const query = useChannelUnreadCounts();
      return sidebarUnreadCounts({ data: query.data, isError: query.isError });
    },
    { wrapper },
  );
  return { queryClient, ...view };
}

function remember(rows: ChannelUnreadCount[], chapterId = "chapter-1") {
  storage.getItem.mockImplementation(async (key: string) =>
    key === unreadMemoryKey("auth-1", chapterId) ? JSON.stringify(rows) : null,
  );
}

beforeEach(() => {
  session.value = {
    status: "authenticated",
    userId: "auth-1",
    chapterId: "chapter-1",
    isChapterResolving: false,
  };
  tray.channelIds = [];
  tray.held = null;
  appState.currentState = "active";
  appState.listeners.clear();
  storage.getItem.mockReset().mockResolvedValue(null);
  storage.setItem.mockReset().mockResolvedValue(undefined);
});

let releaseViewed: (() => void) | null = null;

afterEach(() => {
  vi.useRealTimers();
  releaseViewed?.();
  releaseViewed = null;
});

describe("cold start", () => {
  it("lights the channel a tray push names while the unread request is pending", async () => {
    remember([row("general"), row("events", 3, 1)]);
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result } = mount(api);

    await waitFor(() => expect(result.current).toBeDefined());
    expect(api.requests()).toBe(1);
    expect(result.current?.get("general")).toEqual({
      unreadCount: 1,
      mentionCount: 0,
    });
    // A channel that already had a count keeps the server's last numbers.
    expect(result.current?.get("events")).toEqual({
      unreadCount: 3,
      mentionCount: 1,
    });
  });

  it("drops the mark when the server says the channel was read elsewhere", async () => {
    remember([row("general", 2)]);
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result } = mount(api);
    await waitFor(() =>
      expect(result.current?.get("general")?.unreadCount).toBe(2),
    );

    await api.answer([row("general", 0)]);

    expect(result.current?.get("general")?.unreadCount).toBe(0);
  });

  it("still sends the request when the saved answer is seconds old", async () => {
    remember([row("general")]);
    const api = heldApi();
    const { result, queryClient } = mount(api);
    await waitFor(() => expect(result.current).toBeDefined());

    expect(api.requests()).toBe(1);
    expect(
      queryClient.getQueryState(CHANNEL_UNREAD_COUNTS_KEY)?.dataUpdatedAt,
    ).toBe(0);
  });

  it("shows nothing early with no saved answer, and never invents rows from the tray", async () => {
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result } = mount(api);
    await act(async () => {});

    expect(result.current).toBeUndefined();
  });

  it("doesn't write over an answer that landed before the phone's own reads did", async () => {
    let release: (value: string | null) => void = () => {};
    storage.getItem.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result } = mount(api);

    await api.answer([row("general", 0)]);
    await act(async () => release(JSON.stringify([row("general", 5)])));

    expect(result.current?.get("general")?.unreadCount).toBe(0);
  });

  it("leaves a failed read's error in place", async () => {
    let release: (value: string | null) => void = () => {};
    storage.getItem.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const api = heldApi();
    const { result, queryClient } = mount(api);

    await api.reject();
    await act(async () => release(JSON.stringify([row("general", 5)])));

    expect(result.current).toBeUndefined();
    expect(queryClient.getQueryState(CHANNEL_UNREAD_COUNTS_KEY)?.status).toBe(
      "error",
    );
  });

  it("reads the saved answer of this member and chapter only", async () => {
    remember([row("general", 4)], "chapter-2");
    const api = heldApi();
    const { result } = mount(api);
    await act(async () => {});

    expect(result.current).toBeUndefined();
  });

  it("waits for the chapter claim, and does nothing signed out", async () => {
    session.value = { ...session.value, isChapterResolving: true };
    const api = heldApi();
    const { rerender } = mount(api);
    await act(async () => {});
    expect(storage.getItem).not.toHaveBeenCalled();

    session.value = {
      ...session.value,
      status: "unauthenticated",
      userId: null,
    };
    rerender();
    await act(async () => {});
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});

describe("resume", () => {
  async function resumed(first: ChannelUnreadCount[]) {
    const api = heldApi();
    const view = mount(api);
    await act(async () => {});
    await api.answer(first);
    return { api, ...view };
  }

  it("lights a tray push's channel at once, before any new answer", async () => {
    const { api, result } = await resumed([row("general"), row("dm")]);
    expect(result.current?.get("general")?.unreadCount).toBe(0);

    tray.channelIds = ["general"];
    await foreground();

    expect(result.current?.get("general")?.unreadCount).toBe(1);
    expect(result.current?.get("dm")?.unreadCount).toBe(0);
    // Nothing answered in between: only the first request has gone out here.
    expect(api.requests()).toBe(1);
  });

  it("keeps the cached answer stale, so the resume's own read still goes out", async () => {
    const { result, queryClient } = await resumed([row("general")]);
    const answeredAt = queryClient.getQueryState(
      CHANNEL_UNREAD_COUNTS_KEY,
    )?.dataUpdatedAt;

    tray.channelIds = ["general"];
    await foreground();

    expect(result.current?.get("general")?.unreadCount).toBe(1);
    expect(
      queryClient.getQueryState(CHANNEL_UNREAD_COUNTS_KEY)?.dataUpdatedAt,
    ).toBe(answeredAt);
  });

  it("doesn't relight a channel the server answered for after the app came forward", async () => {
    const { api, result, queryClient } = await resumed([row("general")]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);

    // The app comes forward with a push for the channel still in the tray,
    // and the server's answer (read on another device) lands before the tray
    // read does.
    tray.channelIds = ["general"];
    let letGo: () => void = () => {};
    tray.held = new Promise((resolve) => (letGo = resolve));
    await foreground();
    void queryClient.invalidateQueries({ queryKey: CHANNEL_UNREAD_COUNTS_KEY });
    await act(async () => {});
    expect(api.requests()).toBe(2);
    vi.setSystemTime(Date.now() + 1_000);
    await api.answer([row("general")]);

    await act(async () => {
      letGo();
      await settled();
    });

    expect(result.current?.get("general")?.unreadCount).toBe(0);
  });

  it("leaves the thread on screen alone, and a mere glance at the shade", async () => {
    const { result } = await resumed([row("general"), row("events")]);
    releaseViewed = claimViewedChannel("general");

    tray.channelIds = ["general", "events"];
    await foreground("inactive");
    expect(result.current?.get("events")?.unreadCount).toBe(0);

    await foreground();
    expect(result.current?.get("general")?.unreadCount).toBe(0);
    expect(result.current?.get("events")?.unreadCount).toBe(1);
  });
});

describe("what is saved for the next launch", () => {
  it("saves each server answer under the member and chapter, and nothing the phone lit itself", async () => {
    remember([row("general")]);
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result } = mount(api);
    await waitFor(() =>
      expect(result.current?.get("general")?.unreadCount).toBe(1),
    );
    expect(storage.setItem).not.toHaveBeenCalled();

    await api.answer([row("general", 2, 1)]);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(
      unreadMemoryKey("auth-1", "chapter-1"),
      JSON.stringify([row("general", 2, 1)]),
    );

    // Lit on resume: still only the server's answer on disk.
    tray.channelIds = ["general", "other"];
    await foreground();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
});

describe("the pieces", () => {
  it("lights only fully read rows, and returns the same array when nothing changes", () => {
    const rows = [row("a"), row("b", 4, 2)];
    expect(lightChannels(rows, new Set(["b", "elsewhere"]))).toBe(rows);
    expect(lightChannels(rows, new Set(["a"]))).toEqual([
      row("a", 1),
      row("b", 4, 2),
    ]);
  });

  it("refuses anything that isn't a saved answer", () => {
    expect(parseUnreadMemory(null)).toBeNull();
    expect(parseUnreadMemory("{")).toBeNull();
    expect(parseUnreadMemory('{"channel_id":"a"}')).toBeNull();
    expect(
      parseUnreadMemory('[{"channel_id":"a","unread_count":"1"}]'),
    ).toBeNull();
    expect(parseUnreadMemory(JSON.stringify([row("a", 1)]))).toEqual([
      row("a", 1),
    ]);
  });

  it("keys a token with no chapter under a stable name", () => {
    expect(unreadMemoryKey("u", null)).toBe("frapp.chat.unread.u.sole");
    expect(unreadMemoryKey("u", "c")).toBe("frapp.chat.unread.u.c");
  });
});
