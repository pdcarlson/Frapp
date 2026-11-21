/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FetchHistoryPage } from "@repo/chat-core/history";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";

const hookFetchPage = vi.fn<FetchHistoryPage>(async () => ({
  rows: [],
  actions: [],
}));

vi.mock("@/lib/supabase", () => ({ getSupabaseClient: () => null }));
vi.mock("@repo/hooks", () => ({ useFrappClient: () => ({}) }));
vi.mock("@repo/chat-core/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/chat-core/history")>()),
  createHistoryPageFetcher: () => hookFetchPage,
}));

const {
  prefetchChannelMessages,
  takeReadAhead,
  usePrefetchUnreadChannels,
  CHANNEL_MESSAGES_GC_TIME,
  UNREAD_PREFETCH_LIMIT,
} = await import("./prefetch-channel");

function row(channelId: string, n: number): RawChatMessage {
  return {
    id: `${channelId}-m${n}`,
    channel_id: channelId,
    sender_id: "u1",
    content: `message ${n}`,
    kind: "text",
    created_at: new Date(Date.UTC(2026, 10, 12, 0, 0, n)).toISOString(),
    client_message_id: `${channelId}-cm${n}`,
  };
}

async function settle(queryClient: QueryClient) {
  await vi.waitFor(() => {
    expect(queryClient.isFetching()).toBe(0);
  });
}

describe("prefetchChannelMessages (#3699)", () => {
  test("reads the newest page into the key the thread reads, and marks it read ahead", async () => {
    const queryClient = new QueryClient();
    const fetchPage = vi.fn<FetchHistoryPage>(async () => ({
      rows: [row("c1", 1), row("c1", 2)],
      actions: [],
    }));

    prefetchChannelMessages(queryClient, fetchPage, "c1");
    await settle(queryClient);

    const cache = queryClient.getQueryData<ChannelCache>(chatMessagesKey("c1"));
    expect(cache!.order).toHaveLength(2);
    // Kept as long as the thread keeps it, so it outlives the walk there.
    expect(
      queryClient.getQueryCache().find({ queryKey: chatMessagesKey("c1") })
        ?.gcTime,
    ).toBe(CHANNEL_MESSAGES_GC_TIME);
    // The thread re-reads it once when it opens, and only once.
    expect(takeReadAhead("c1")).toBe(true);
    expect(takeReadAhead("c1")).toBe(false);
  });

  test("leaves a channel already in the cache alone, and does not mark it", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(chatMessagesKey("c2"), {
      byId: {},
      order: [],
      actionIndex: {},
    });
    const fetchPage = vi.fn<FetchHistoryPage>();

    prefetchChannelMessages(queryClient, fetchPage, "c2");
    await settle(queryClient);

    expect(fetchPage).not.toHaveBeenCalled();
    expect(takeReadAhead("c2")).toBe(false);
  });

  test("drops a failed read without throwing, so the thread reads for itself", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fetchPage = vi.fn<FetchHistoryPage>(async () => {
      throw new Error("offline");
    });

    expect(() =>
      prefetchChannelMessages(queryClient, fetchPage, "c3"),
    ).not.toThrow();
    await settle(queryClient);

    expect(queryClient.getQueryData(chatMessagesKey("c3"))).toBeUndefined();
    expect(takeReadAhead("c3")).toBe(false);
  });
});

describe("usePrefetchUnreadChannels (#3699)", () => {
  function render(ids: string[], enabled: boolean) {
    const queryClient = new QueryClient();
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = renderHook(
      (props: { ids: string[]; enabled: boolean }) =>
        usePrefetchUnreadChannels(props.ids, props.enabled),
      { wrapper: Wrapper, initialProps: { ids, enabled } },
    );
    return { queryClient, view };
  }

  test("reads nothing while disabled, then at most the limit once enabled", async () => {
    hookFetchPage.mockClear();
    const ids = Array.from({ length: 10 }, (_, i) => `u${i}`);
    const { queryClient, view } = render(ids, false);
    await settle(queryClient);
    expect(hookFetchPage).not.toHaveBeenCalled();

    view.rerender({ ids, enabled: true });
    await settle(queryClient);

    expect(hookFetchPage).toHaveBeenCalledTimes(UNREAD_PREFETCH_LIMIT);
    expect(hookFetchPage.mock.calls.map(([id]) => id)).toEqual(
      ids.slice(0, UNREAD_PREFETCH_LIMIT),
    );
    for (const id of ids) takeReadAhead(id);
  });
});

describe("root layout", () => {
  test("gives the navigators the app's theme", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const layout = readFileSync(join(process.cwd(), "app/_layout.tsx"), "utf8");
    expect(layout).toMatch(/<ThemeProvider value=\{navigationTheme\}>/);
    expect(layout).toContain("navigationThemeFor(tokens)");
  });
});
