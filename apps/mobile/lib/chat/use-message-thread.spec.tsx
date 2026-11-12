/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheFromPage } from "@repo/chat-core/cache";
import {
  chatMessagesKey,
  chatThreadRepliesKey,
  type RawChatMessage,
} from "@repo/chat-core/types";

/**
 * The phone's `useMessageThread` clears the channel's thread cards' "N new"
 * once it marks the thread read (#4297), as web's does
 * (`apps/web/lib/chat/use-message-thread.spec.tsx`). The reads and the
 * transport are stubbed; what is under test is the re-read.
 */

const mocks = vi.hoisted(() => ({
  fetchThread: vi.fn(),
  loadThreadReplies: vi.fn(async () => ({ hasMore: false })),
  markThreadRead: vi.fn(async () => undefined),
  sendThreadReply: vi.fn(async () => ({ error: null })),
}));

vi.mock("@repo/hooks", () => ({ useFrappClient: () => ({}) }));
vi.mock("@repo/chat-core/realtime-manager", () => ({
  NO_TYPING_USERS: Object.freeze([]),
  POLL_INTERVAL_MS: 5_000,
  chatRealtime: {
    subscribeStatus: () => () => undefined,
    onThreadReply: () => () => undefined,
    getTypingUsers: () => Object.freeze([]),
    subscribeTyping: () => () => undefined,
    emitTyping: vi.fn(),
  },
}));
vi.mock("@repo/chat-core/threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/chat-core/threads")>()),
  fetchThread: mocks.fetchThread,
  loadThreadReplies: mocks.loadThreadReplies,
  markThreadRead: mocks.markThreadRead,
  sendThreadReply: mocks.sendThreadReply,
}));

const { useHeldChannelMessage, useMessageThread } =
  await import("./use-message-thread");

const ROOT = {
  id: "root",
  channel_id: "c1",
  sender_id: "paul",
  kind: "text",
  content: "Who's driving?",
  created_at: "2026-11-10T12:00:00.000Z",
} as RawChatMessage;

afterEach(() => vi.clearAllMocks());

describe("useMessageThread on the phone (#4297)", () => {
  it("re-reads the followed threads once the thread is marked read", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.fetchThread.mockResolvedValue({
      root: ROOT,
      follow_state: null,
      last_read_at: null,
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useMessageThread("c1", "root", "me"), { wrapper });
    await waitFor(() => expect(mocks.markThreadRead).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["chat-followed-threads", "c1"],
      }),
    );
  });
});

/** The open thread's full rows (#4297, slice 5). */
describe("useMessageThread's parent and retry on the phone", () => {
  function setup() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, wrapper };
  }

  it("folds the parent's reactions into it, as web's does", async () => {
    mocks.fetchThread.mockResolvedValue({
      root: ROOT,
      follow_state: null,
      last_read_at: null,
      root_actions: [
        {
          id: "a1",
          message_id: "root",
          user_id: "casey",
          action_type: "reaction:👍",
          created_at: "2026-11-10T12:01:00.000Z",
        },
      ],
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMessageThread("c1", "root", "me"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.root).not.toBeNull());
    expect(result.current.root?.reactions).toEqual({
      "reaction:👍": ["casey"],
    });
  });

  it("re-sends a failed reply under its own client id", async () => {
    mocks.fetchThread.mockResolvedValue({
      root: ROOT,
      follow_state: "following",
      last_read_at: null,
    });
    const { queryClient, wrapper } = setup();
    // A failed reply already in the thread's cache.
    queryClient.setQueryData(
      chatThreadRepliesKey("c1", "root"),
      cacheFromPage(
        [
          {
            ...ROOT,
            id: "r9",
            client_message_id: "c-r9",
            content: "lost",
            thread_root_id: "root",
          } as RawChatMessage,
        ],
        [],
      ),
    );
    const { result } = renderHook(() => useMessageThread("c1", "root", "me"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => {
      await result.current.retry("c-r9");
    });
    expect(mocks.sendThreadReply).toHaveBeenCalledWith(
      queryClient,
      {},
      expect.objectContaining({
        channelId: "c1",
        rootId: "root",
        content: "lost",
        clientMessageId: "c-r9",
      }),
    );
    // A row the thread doesn't hold sends nothing.
    mocks.sendThreadReply.mockClear();
    await expect(result.current.retry("c-missing")).resolves.toEqual({
      error: null,
    });
    expect(mocks.sendThreadReply).not.toHaveBeenCalled();
  });

  it("reads the channel cache's copy of a message, and follows it", async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useHeldChannelMessage("c1", "root"), {
      wrapper,
    });
    expect(result.current).toBeNull();
    act(() => {
      queryClient.setQueryData(
        chatMessagesKey("c1"),
        cacheFromPage([{ ...ROOT, client_message_id: "c-root" }], []),
      );
    });
    expect(result.current?.content).toBe("Who's driving?");
    act(() => {
      queryClient.setQueryData(
        chatMessagesKey("c1"),
        cacheFromPage(
          [{ ...ROOT, client_message_id: "c-root", content: "Edited" }],
          [],
        ),
      );
    });
    expect(result.current?.content).toBe("Edited");
  });
});
