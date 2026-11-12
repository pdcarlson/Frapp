/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  ASK_COPY,
  ASK_STREAM_VERSION,
  encodeAskStreamEvent,
  type AskAnswer,
  type AskStreamEvent,
} from "@repo/validation";
import {
  applyAskEvent,
  useAsk,
  useAskStatus,
  useSetAskDiagnostics,
  type AskExchange,
} from "./use-ask";
import { FrappClientProvider } from "./use-frapp-client";

const v = ASK_STREAM_VERSION;

const ANSWER: AskAnswer = {
  status: "answered",
  reason: null,
  text: "Quorum is two-thirds.",
  citations: [{ source: 0, at: 21, quote: "two-thirds" }],
  sources: [
    {
      id: "p1",
      kind: "document",
      title: "Bylaws",
      detail: null,
      date: null,
      target: { type: "document", document_id: "d1", page: null },
    },
  ],
  left_out_messages: 0,
  unverified_citations: 0,
  truncated: false,
  saved: false,
};

const WORKING: AskExchange = {
  question: "What is quorum?",
  phase: "working",
  step: "searching",
  preview: "",
  answer: null,
  failure: null,
};

/** A response body that delivers `chunks` one read at a time. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const streamed = (events: AskStreamEvent[]) => ({
  data: streamOf(events.map(encodeAskStreamEvent)),
  error: undefined,
  response: { status: 200, ok: true },
});

const refusedWith = (error: { statusCode: number; code?: string }) => ({
  data: undefined,
  error,
  response: { status: error.statusCode, ok: false },
});

describe("applyAskEvent", () => {
  it("names the step, then gathers the text as a preview", () => {
    let exchange = applyAskEvent(WORKING, { v, type: "status", step: "writing" });
    exchange = applyAskEvent(exchange, { v, type: "text", delta: "Quorum " });
    exchange = applyAskEvent(exchange, { v, type: "text", delta: "is" });
    expect(exchange).toMatchObject({
      phase: "working",
      step: "writing",
      preview: "Quorum is",
    });
  });

  it("replaces the preview with the checked answer on done", () => {
    const streaming = { ...WORKING, preview: "Quorum is three people, I think" };
    expect(
      applyAskEvent(streaming, { v, type: "done", answer: ANSWER }),
    ).toMatchObject({ phase: "done", preview: "", step: null, answer: ANSWER });
  });

  it("drops what streamed when the stream reports an error", () => {
    const streaming = { ...WORKING, preview: "Quorum is" };
    expect(
      applyAskEvent(streaming, {
        v,
        type: "error",
        code: "ai.ask.failed",
        retryable: false,
      }),
    ).toMatchObject({
      phase: "failed",
      preview: "",
      failure: { message: ASK_COPY.failed, retryable: false },
    });
  });

  it("ignores anything after the answer is final", () => {
    const done = applyAskEvent(WORKING, { v, type: "done", answer: ANSWER });
    expect(applyAskEvent(done, { v, type: "text", delta: "more" })).toBe(done);
  });
});

describe("the Ask hooks", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  const wrapper = (client: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={client as ReturnType<typeof createFrappClient>}
        chapterId="chapter-1"
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "AskHookWrapper";
    return Wrapper;
  };

  it("streams a question to its checked answer", async () => {
    const POST = vi.fn().mockResolvedValue(
      streamed([
        { v, type: "start", ask_id: "a1" },
        { v, type: "status", step: "reading" },
        { v, type: "text", delta: "Quorum" },
        { v, type: "done", answer: ANSWER },
      ]),
    );
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("  What is quorum?  "));
    expect(POST).toHaveBeenCalledWith(
      "/v1/ai/ask",
      expect.objectContaining({
        body: { question: "What is quorum?" },
        parseAs: "stream",
      }),
    );
    expect(result.current.exchange).toMatchObject({
      question: "What is quorum?",
      phase: "done",
      answer: ANSWER,
    });
  });

  it("says the saved notice was shown only when the caller says it was", async () => {
    const POST = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(streamed([{ v, type: "done", answer: ANSWER }])),
      );
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("One?"));
    await act(() => result.current.ask("Two?", { savedNoticeShown: true }));
    expect(POST.mock.calls[0]![1].body).toEqual({ question: "One?" });
    expect(POST.mock.calls[1]![1].body).toEqual({
      question: "Two?",
      saved_notice_shown: true,
    });
  });

  it.each([
    ["ai.consent.required", "consent_required"],
    ["ai.chapter_off", "chapter_off"],
    ["ai.not_available", "not_available"],
  ])("turns the refusal %s into an unavailable answer", async (code, reason) => {
    const POST = vi
      .fn()
      .mockResolvedValue(refusedWith({ statusCode: 403, code }));
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("Anything?"));
    expect(result.current.exchange).toMatchObject({
      phase: "done",
      answer: { status: "unavailable", reason },
    });
  });

  it("fails, and can be retried, when the stream ends without an answer", async () => {
    const POST = vi
      .fn()
      .mockResolvedValue(streamed([{ v, type: "text", delta: "Quor" }]));
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("What is quorum?"));
    expect(result.current.exchange).toMatchObject({
      phase: "failed",
      preview: "",
      failure: { message: ASK_COPY.failed, retryable: true },
    });
  });

  it("fails in words when the request never connects", async () => {
    const POST = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("What is quorum?"));
    expect(result.current.exchange?.phase).toBe("failed");
  });

  it("asks nothing for an empty question", async () => {
    const POST = vi.fn();
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("   "));
    expect(POST).not.toHaveBeenCalled();
    expect(result.current.exchange).toBeNull();
  });

  it("reads a server with AI off as no status, not as a failure", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue(refusedWith({ statusCode: 404, code: "ai.not_available" }));
    const { result } = renderHook(() => useAskStatus(), {
      wrapper: wrapper({ GET }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("writes a started window into the status Ask reads", async () => {
    const off = { offered: true, can_change: true, ends_at: null };
    const on = { ...off, ends_at: "2026-11-26T12:00:00.000Z" };
    const ok = (data: unknown) => ({
      data,
      error: undefined,
      response: { status: 200, ok: true },
    });
    const client = {
      GET: vi.fn().mockResolvedValue(ok({ saved_until: null, diagnostics: off })),
      POST: vi.fn().mockResolvedValue(ok(on)),
      DELETE: vi.fn().mockResolvedValue(ok(off)),
    };
    const { result } = renderHook(
      () => ({ status: useAskStatus(), change: useSetAskDiagnostics() }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.status.isSuccess).toBe(true));
    await act(() => result.current.change.mutateAsync(true));
    expect(client.POST).toHaveBeenCalledWith("/v1/ai/ask/diagnostics");
    await waitFor(() =>
      expect(result.current.status.data).toEqual({
        saved_until: on.ends_at,
        diagnostics: on,
      }),
    );
    await act(() => result.current.change.mutateAsync(false));
    expect(client.DELETE).toHaveBeenCalledWith("/v1/ai/ask/diagnostics");
    await waitFor(() =>
      expect(result.current.status.data?.saved_until).toBeNull(),
    );
  });
});
