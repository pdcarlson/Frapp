/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { useThreadUnread } from "./use-thread-unread";

const fetchThreadUnread = vi.fn(async () => ({ a: 2 }));
vi.mock("@repo/hooks", () => ({ useFrappClient: () => ({}) }));
vi.mock("@repo/chat-core/realtime-manager", () => ({
  POLL_INTERVAL_MS: 5_000,
  chatRealtime: { subscribeStatus: () => () => undefined },
}));
vi.mock("@repo/chat-core/threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/chat-core/threads")>()),
  fetchThreadUnread: (...args: unknown[]) => fetchThreadUnread(...(args as [])),
}));

const row = (id: string, last_reply_at: string | null | undefined) =>
  ({
    id,
    thread:
      last_reply_at === undefined
        ? null
        : { reply_count: 1, last_reply_at, recent_sender_ids: [] },
  }) as ChatMessage;

/** The phone's twin of web's hook (#4297): the same rule, from chat-core. */
describe("useThreadUnread on the phone (#4297)", () => {
  function setup(initial: ChatMessage[]) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(
      ({ messages }: { messages: ChatMessage[] }) =>
        useThreadUnread("chan-1", messages),
      { wrapper, initialProps: { messages: initial } },
    );
  }

  it("reads nothing while no loaded message has a thread", async () => {
    fetchThreadUnread.mockClear();
    const { result } = setup([row("a", undefined)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchThreadUnread).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });

  it("reads the counts, and reads again when a parent gains a reply", async () => {
    fetchThreadUnread.mockClear();
    const { result, rerender } = setup([row("a", "2026-11-11T20:00:00Z")]);
    await waitFor(() => expect(result.current).toEqual({ a: 2 }));
    expect(fetchThreadUnread).toHaveBeenCalledTimes(1);
    rerender({ messages: [row("a", "2026-11-11T20:05:00Z")] });
    await waitFor(() => expect(fetchThreadUnread).toHaveBeenCalledTimes(2));
  });
});
