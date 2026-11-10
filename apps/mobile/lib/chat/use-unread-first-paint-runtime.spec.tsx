/** @vitest-environment jsdom */
/**
 * #4006: the unread marks must not wait on `GET /v1/channels/unread`, and the
 * server's answer must replace whatever was shown before it.
 *
 * The runtime and the reader are run together against the real
 * `useChannelUnreadCounts`, with the API held: what a test reads is what chat
 * home draws from (`useShownUnreadCounts` through `sidebarUnreadCounts`).
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_UNREAD_COUNTS_KEY,
  FrappClientProvider,
  claimViewedChannel,
  sidebarUnreadCounts,
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

import {
  resetUnreadFirstPaintForTests,
  useShownUnreadCounts,
} from "./unread-first-paint";
import { unreadMemoryKey } from "./unread-memory";
import { useUnreadFirstPaintRuntime } from "./use-unread-first-paint-runtime";

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

/** Back from the background, with the tray read settled. */
function foreground(from = "background") {
  return act(async () => {
    for (const next of [from, "active"]) {
      appState.currentState = next;
      for (const listener of [...appState.listeners]) listener(next);
    }
    await settled();
  });
}

/** The API, with each `GET /v1/channels/unread` held until the test answers. */
function heldApi() {
  const pending: {
    answer: (rows: ChannelUnreadCount[]) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const client = {
    GET: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          pending.push({
            answer: (rows) => resolve({ data: rows, error: undefined }),
            reject,
          });
        }),
    ),
  };
  return {
    client,
    requests: () => client.GET.mock.calls.length,
    answer: (rows: ChannelUnreadCount[]) =>
      act(async () => {
        pending.shift()?.answer(rows);
        await settled();
      }),
    reject: () =>
      act(async () => {
        pending.shift()?.reject(new Error("down"));
        await settled();
      }),
  };
}

/** The app from launch: the runtime, and a screen reading the counts. */
async function launch(api: ReturnType<typeof heldApi>) {
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
      const shown = useShownUnreadCounts();
      return {
        marks: sidebarUnreadCounts(shown),
        provisional: shown.provisional,
        isError: shown.isError,
      };
    },
    { wrapper },
  );
  // The phone's own reads (storage, tray): no request has answered.
  await act(async () => settled());
  return { queryClient, ...view };
}

function remember(rows: ChannelUnreadCount[], chapterId = "chapter-1") {
  storage.getItem.mockImplementation(async (key: string) =>
    key === unreadMemoryKey("auth-1", chapterId) ? JSON.stringify(rows) : null,
  );
}

let releaseViewed: (() => void) | null = null;

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
  resetUnreadFirstPaintForTests();
  storage.getItem.mockReset().mockResolvedValue(null);
  storage.setItem.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  releaseViewed?.();
  releaseViewed = null;
});

describe("cold start, with the unread request pending", () => {
  it("shows the saved counts with the tray's channel lit", async () => {
    remember([row("general"), row("events", 3, 1)]);
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result, queryClient } = await launch(api);

    expect(api.requests()).toBe(1);
    expect(result.current.marks?.get("general")).toEqual({
      unreadCount: 1,
      mentionCount: 0,
    });
    // A channel that already had a count keeps the server's last numbers.
    expect(result.current.marks?.get("events")).toEqual({
      unreadCount: 3,
      mentionCount: 1,
    });
    expect(result.current.provisional).toBe(true);
    // Nothing was written into the cache: it still has no answer.
    expect(queryClient.getQueryData(CHANNEL_UNREAD_COUNTS_KEY)).toBeUndefined();
  });

  it("lights a tray channel with no saved answer at all", async () => {
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result } = await launch(api);

    expect(result.current.marks?.get("general")?.unreadCount).toBe(1);
    expect(result.current.provisional).toBe(true);
  });

  it("shows nothing early with neither", async () => {
    const api = heldApi();
    const { result } = await launch(api);

    expect(result.current.marks).toBeUndefined();
    expect(result.current.provisional).toBe(false);
  });

  it("goes dark when the server says the channel was read elsewhere", async () => {
    remember([row("general", 2)]);
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result } = await launch(api);
    expect(result.current.marks?.get("general")?.unreadCount).toBe(2);

    await api.answer([row("general", 0)]);

    expect(result.current.marks?.get("general")?.unreadCount).toBe(0);
    expect(result.current.provisional).toBe(false);
  });

  it("says the read failed, not the saved counts", async () => {
    remember([row("general", 5)]);
    tray.channelIds = ["general"];
    const api = heldApi();
    const { result } = await launch(api);

    await api.reject();

    expect(result.current.isError).toBe(true);
    expect(result.current.marks).toBeUndefined();
  });

  it("reads the saved answer of this member and chapter only", async () => {
    remember([row("general", 4)], "chapter-2");
    const api = heldApi();
    const { result } = await launch(api);

    expect(result.current.marks).toBeUndefined();
  });

  it("waits for the chapter claim, and drops the saved answer when the member changes", async () => {
    remember([row("general", 4)]);
    session.value = { ...session.value, isChapterResolving: true };
    const api = heldApi();
    const { result, rerender } = await launch(api);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(result.current.marks).toBeUndefined();

    session.value = { ...session.value, isChapterResolving: false };
    rerender();
    await act(async () => settled());
    expect(result.current.marks?.get("general")?.unreadCount).toBe(4);

    session.value = { ...session.value, userId: "auth-2" };
    rerender();
    await act(async () => settled());
    expect(result.current.marks).toBeUndefined();
  });

  it("doesn't show a saved answer that was read for the member before", async () => {
    let letGo: (value: string | null) => void = () => {};
    storage.getItem.mockImplementation(
      () => new Promise((resolve) => (letGo = resolve)),
    );
    const api = heldApi();
    const { result, rerender } = await launch(api);

    session.value = {
      ...session.value,
      status: "unauthenticated",
      userId: null,
    };
    rerender();
    await act(async () => {
      letGo(JSON.stringify([row("general", 4)]));
      await settled();
    });

    expect(result.current.marks).toBeUndefined();
  });
});

describe("resume", () => {
  async function running(first: ChannelUnreadCount[]) {
    const api = heldApi();
    const view = await launch(api);
    await api.answer(first);
    return { api, ...view };
  }

  it("lights a tray push's channel while the resume's own request is pending", async () => {
    const { api, result, queryClient } = await running([
      row("general"),
      row("dm"),
    ]);
    expect(result.current.marks?.get("general")?.unreadCount).toBe(0);

    tray.channelIds = ["general"];
    await foreground();
    void queryClient.invalidateQueries({ queryKey: CHANNEL_UNREAD_COUNTS_KEY });
    await act(async () => settled());

    expect(api.requests()).toBe(2);
    expect(result.current.marks?.get("general")?.unreadCount).toBe(1);
    expect(result.current.marks?.get("dm")?.unreadCount).toBe(0);
    // Real counts with one row lit: still good enough to filter on.
    expect(result.current.provisional).toBe(false);
  });

  it("lights a channel the cached answer has no row for", async () => {
    const { result } = await running([row("general")]);

    tray.channelIds = ["new-dm"];
    await foreground();

    expect(result.current.marks?.get("new-dm")).toEqual({
      unreadCount: 1,
      mentionCount: 0,
    });
  });

  it("goes dark once the server answers after the app came forward", async () => {
    const { api, result, queryClient } = await running([row("general")]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    tray.channelIds = ["general"];
    await foreground();
    expect(result.current.marks?.get("general")?.unreadCount).toBe(1);

    void queryClient.invalidateQueries({ queryKey: CHANNEL_UNREAD_COUNTS_KEY });
    await act(async () => settled());
    vi.setSystemTime(Date.now() + 1_000);
    await api.answer([row("general")]);

    expect(result.current.marks?.get("general")?.unreadCount).toBe(0);
  });

  it("stays dark when the tray read lands after the server's answer", async () => {
    const { api, result, queryClient } = await running([row("general")]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    tray.channelIds = ["general"];
    let letGo: () => void = () => {};
    tray.held = new Promise((resolve) => (letGo = resolve));
    await foreground();

    void queryClient.invalidateQueries({ queryKey: CHANNEL_UNREAD_COUNTS_KEY });
    await act(async () => settled());
    vi.setSystemTime(Date.now() + 1_000);
    await api.answer([row("general")]);
    await act(async () => {
      letGo();
      await settled();
    });

    expect(result.current.marks?.get("general")?.unreadCount).toBe(0);
  });

  it("leaves a failed read's error on screen", async () => {
    const { api, result, queryClient } = await running([row("general")]);
    void queryClient.invalidateQueries({ queryKey: CHANNEL_UNREAD_COUNTS_KEY });
    await act(async () => settled());
    await api.reject();
    expect(result.current.isError).toBe(true);

    tray.channelIds = ["general"];
    await foreground();

    expect(result.current.isError).toBe(true);
    expect(result.current.marks).toBeUndefined();
    expect(queryClient.getQueryState(CHANNEL_UNREAD_COUNTS_KEY)?.status).toBe(
      "error",
    );
  });

  it("leaves the thread on screen alone, and a mere glance at the shade", async () => {
    const { result } = await running([row("general"), row("events")]);
    releaseViewed = claimViewedChannel("general");

    tray.channelIds = ["general", "events"];
    await foreground("inactive");
    expect(result.current.marks?.get("events")?.unreadCount).toBe(0);

    await foreground();
    expect(result.current.marks?.get("general")?.unreadCount).toBe(0);
    expect(result.current.marks?.get("events")?.unreadCount).toBe(1);
  });
});

describe("what is saved for the next launch", () => {
  it("saves each server answer under the member and chapter, once", async () => {
    remember([row("general")]);
    tray.channelIds = ["general"];
    const api = heldApi();
    const { queryClient } = await launch(api);
    expect(storage.setItem).not.toHaveBeenCalled();

    await api.answer([row("general", 2, 1)]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(
      unreadMemoryKey("auth-1", "chapter-1"),
      JSON.stringify([row("general", 2, 1)]),
    );

    // The same answer again, and the fetch that leads to it, save nothing.
    void queryClient.invalidateQueries({ queryKey: CHANNEL_UNREAD_COUNTS_KEY });
    await act(async () => settled());
    await api.answer([row("general", 2, 1)]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("saves no other query's answer, and no optimistic write", async () => {
    const api = heldApi();
    const { queryClient } = await launch(api);

    await act(async () => {
      // Another query answering with an empty list, which would pass as counts.
      await queryClient.fetchQuery({
        queryKey: ["channels", "latest"],
        queryFn: async () => [],
      });
      queryClient.setQueryData(CHANNEL_UNREAD_COUNTS_KEY, [row("general", 9)]);
      await settled();
    });

    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("saves nothing signed out", async () => {
    session.value = {
      ...session.value,
      status: "unauthenticated",
      userId: null,
    };
    const api = heldApi();
    await launch(api);

    await api.answer([row("general", 2)]);

    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
