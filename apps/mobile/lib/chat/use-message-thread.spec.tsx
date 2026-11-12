/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawChatMessage } from "@repo/chat-core/types";

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
}));

const { useMessageThread } = await import("./use-message-thread");

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
