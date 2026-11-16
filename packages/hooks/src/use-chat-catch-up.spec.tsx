/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import { CHAT_CATCH_UP_COPY, type ChatCatchUp } from "@repo/validation";
import { aiConsentKey } from "./use-ai";
import { useChatCatchUp, useChatCatchUpAvailable } from "./use-chat-catch-up";
import { FrappClientProvider } from "./use-frapp-client";

const SUMMARY: ChatCatchUp = {
  status: "summarized",
  reason: null,
  points: [
    {
      kind: "decision",
      text: "Formal is at the boathouse.",
      message_id: "m1",
      thread_root_id: null,
      author_id: "sam",
      sent_at: "2026-11-10T18:00:00.000Z",
      quote: "the boathouse it is",
    },
  ],
  messages_read: 140,
  messages_total: 140,
  left_out_messages: 4,
  unverified_points: 0,
  covers_from: "2026-11-10T15:00:00.000Z",
  covers_to: "2026-11-10T18:00:00.000Z",
};

const ok = <T,>(data: T) => ({
  data,
  error: undefined,
  response: { status: 200, ok: true },
});
const refusedWith = (error: { statusCode: number; code?: string }) => ({
  data: undefined,
  error,
  response: { status: error.statusCode, ok: false },
});

function harness(client: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={client as unknown as ReturnType<typeof createFrappClient>}
      chapterId="chapter-1"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "CatchUpHookWrapper";
  return { queryClient, wrapper: Wrapper };
}

const TARGET = { unread: { count: 140, as_of: "2026-11-10T18:05:00.000Z" } };

describe("useChatCatchUp", () => {
  it("asks for the stretch and holds the summary that comes back", async () => {
    const client = { POST: vi.fn().mockResolvedValue(ok(SUMMARY)) };
    const { result } = renderHook(() => useChatCatchUp(), harness(client));

    await act(() => result.current.run("channel-1", TARGET));

    expect(client.POST).toHaveBeenCalledWith(
      "/v1/ai/catch-up",
      expect.objectContaining({ body: { channel_id: "channel-1", ...TARGET } }),
    );
    expect(result.current.current).toMatchObject({
      channelId: "channel-1",
      phase: "done",
      summary: SUMMARY,
    });
  });

  it("never names more unread messages than a request may", async () => {
    const client = { POST: vi.fn().mockResolvedValue(ok(SUMMARY)) };
    const { result } = renderHook(() => useChatCatchUp(), harness(client));

    // A channel never opened, after an import: every message counts as new.
    await act(() =>
      result.current.run("channel-1", {
        unread: { count: 48_000, as_of: TARGET.unread.as_of },
      }),
    );

    expect(client.POST).toHaveBeenCalledWith(
      "/v1/ai/catch-up",
      expect.objectContaining({
        body: {
          channel_id: "channel-1",
          unread: { count: 5000, as_of: TARGET.unread.as_of },
        },
      }),
    );
  });

  it("shows working until the answer lands, and reset abandons the request", async () => {
    let signal: AbortSignal | undefined;
    const client = {
      POST: vi.fn((_path: string, init: { signal: AbortSignal }) => {
        signal = init.signal;
        return new Promise(() => undefined);
      }),
    };
    const { result } = renderHook(() => useChatCatchUp(), harness(client));

    act(() => void result.current.run("channel-1", TARGET));
    await waitFor(() => expect(result.current.current?.phase).toBe("working"));
    act(() => result.current.reset());

    expect(signal?.aborted).toBe(true);
    expect(result.current.current).toBeNull();
  });

  it.each([
    ["ai.consent.required", "consent_required"],
    ["ai.chapter_off", "chapter_off"],
    ["ai.not_available", "not_available"],
  ])("turns the refusal %s into a reason to show", async (code, reason) => {
    const client = {
      POST: vi.fn().mockResolvedValue(refusedWith({ statusCode: 403, code })),
    };
    const { queryClient, wrapper } = harness(client);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useChatCatchUp(), { wrapper });

    await act(() => result.current.run("channel-1", TARGET));

    expect(result.current.current).toMatchObject({
      phase: "done",
      summary: { status: "unavailable", reason, points: [] },
    });
    // A stale Yes on this device: the sheet's state is read again.
    expect(invalidate).toHaveBeenCalledTimes(
      reason === "consent_required" ? 1 : 0,
    );
    if (reason === "consent_required") {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: aiConsentKey });
    }
  });

  it("fails in words when the request does not go through", async () => {
    const client = { POST: vi.fn().mockRejectedValue(new Error("offline")) };
    const { result } = renderHook(() => useChatCatchUp(), harness(client));
    await act(() => result.current.run("channel-1", TARGET));
    expect(result.current.current).toMatchObject({ phase: "failed" });
    expect(result.current.current?.failure).toBeTruthy();
    expect(CHAT_CATCH_UP_COPY.failed).toBeTruthy();
  });

  it("a newer request replaces an older one still in flight", async () => {
    let first: ((value: unknown) => void) | undefined;
    const client = {
      POST: vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (first = resolve)))
        .mockResolvedValueOnce(ok({ ...SUMMARY, messages_read: 7 })),
    };
    const { result } = renderHook(() => useChatCatchUp(), harness(client));

    act(() => void result.current.run("channel-1", TARGET));
    await act(() => result.current.run("channel-1", { since: "2026-11-09T00:00:00.000Z" }));
    await act(async () => first?.(ok(SUMMARY)));

    expect(result.current.current?.summary?.messages_read).toBe(7);
  });
});

describe("useChatCatchUpAvailable", () => {
  const consent = { sheet: { version: 2 }, answer: null };
  const client = (settings: unknown, permissions: string[]) => ({
    GET: vi.fn((path: string) => {
      if (path === "/v1/ai/consent") return Promise.resolve(ok(consent));
      if (path === "/v1/ai/settings") return Promise.resolve(ok(settings));
      return Promise.resolve(ok({ permissions }));
    }),
  });
  const on = { ask: true, meeting_notes: false, chat_source: true };

  it("is true only with AI on, both switches on and ai:use held", async () => {
    const { result } = renderHook(
      () => useChatCatchUpAvailable(),
      harness(client(on, ["ai:use"])),
    );
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ["chat is not a source", { ...on, chat_source: false }, ["ai:use"]],
    ["Ask is off", { ...on, ask: false }, ["ai:use"]],
    ["the member lacks ai:use", on, ["members:view"]],
  ])("stays false when %s", async (_name, settings, permissions) => {
    const api = client(settings, permissions);
    const { result } = renderHook(
      () => useChatCatchUpAvailable(),
      harness(api),
    );
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBe(false);
  });

  it("stays false on a server with no AI", async () => {
    const api = {
      GET: vi.fn().mockResolvedValue(
        refusedWith({ statusCode: 404, code: "ai.not_available" }),
      ),
    };
    const { result } = renderHook(
      () => useChatCatchUpAvailable(),
      harness(api),
    );
    await waitFor(() => expect(api.GET).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBe(false);
  });
});
