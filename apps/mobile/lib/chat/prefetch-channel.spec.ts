import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import type { FetchHistoryPage } from "@repo/chat-core/history";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";

vi.mock("@/lib/supabase", () => ({ getSupabaseClient: () => null }));
vi.mock("@repo/hooks", () => ({ useFrappClient: () => ({}) }));

const { prefetchChannelMessages, CHANNEL_MESSAGES_GC_TIME } =
  await import("./prefetch-channel");

const CHANNEL = "c1";

function row(n: number): RawChatMessage {
  return {
    id: `m${n}`,
    channel_id: CHANNEL,
    sender_id: "u1",
    content: `message ${n}`,
    kind: "text",
    created_at: new Date(Date.UTC(2026, 10, 12, 0, 0, n)).toISOString(),
    client_message_id: `cm${n}`,
  };
}

async function settle(queryClient: QueryClient) {
  await vi.waitFor(() => {
    expect(queryClient.isFetching()).toBe(0);
  });
}

describe("prefetchChannelMessages (#3699)", () => {
  test("reads the newest page into the key the thread screen reads", async () => {
    const queryClient = new QueryClient();
    const fetchPage = vi.fn<FetchHistoryPage>(async () => ({
      rows: [row(1), row(2)],
      actions: [],
    }));

    prefetchChannelMessages(queryClient, fetchPage, CHANNEL);
    await settle(queryClient);

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey(CHANNEL),
    );
    expect(cache).toBeDefined();
    expect(cache!.order).toHaveLength(2);
    // Kept as long as the thread keeps it, so it outlives the walk there.
    expect(
      queryClient.getQueryCache().find({ queryKey: chatMessagesKey(CHANNEL) })
        ?.gcTime,
    ).toBe(CHANNEL_MESSAGES_GC_TIME);
  });

  test("leaves a channel already in the cache alone", async () => {
    const queryClient = new QueryClient();
    const fetchPage = vi.fn<FetchHistoryPage>(async () => ({
      rows: [row(1)],
      actions: [],
    }));

    prefetchChannelMessages(queryClient, fetchPage, CHANNEL);
    await settle(queryClient);
    prefetchChannelMessages(queryClient, fetchPage, CHANNEL);
    await settle(queryClient);

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  test("drops a failed read without throwing, so the thread reads for itself", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fetchPage = vi.fn<FetchHistoryPage>(async () => {
      throw new Error("offline");
    });

    expect(() =>
      prefetchChannelMessages(queryClient, fetchPage, CHANNEL),
    ).not.toThrow();
    await settle(queryClient);

    expect(queryClient.getQueryData(chatMessagesKey(CHANNEL))).toBeUndefined();
  });
});
