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
  id: "turn-test",
  question: "What is quorum?",
  phase: "working",
  step: "searching",
  preview: "",
  answer: null,
  proposal: null,
  resolution: null,
  failure: null,
};

/** A card that asks for what was left unsaid, as the request route answers. */
const UNCLEAR = {
  status: "unclear",
  action: "give_points",
  suggestion: null,
  notes: [],
  event_choice: null,
  missing: "amount",
  reason: null,
  available_actions: [],
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

  it("ends the turn with the proposal when the member asked for something to be done", () => {
    const streaming = { ...WORKING, preview: "" };
    const turn = applyAskEvent(streaming, { v, type: "proposal", act: UNCLEAR });
    expect(turn).toMatchObject({
      phase: "done",
      step: null,
      answer: null,
      proposal: UNCLEAR,
    });
    expect(applyAskEvent(turn, { v, type: "text", delta: "more" })).toBe(turn);
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
    expect(result.current.exchanges).toHaveLength(1);
    expect(result.current.exchanges[0]).toMatchObject({
      question: "What is quorum?",
      phase: "done",
      answer: ANSWER,
    });
    expect(result.current.working).toBe(false);
  });

  describe("a conversation", () => {
    const answering = () =>
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(streamed([{ v, type: "done", answer: ANSWER }])),
        );

    it("keeps every turn, and sends the turns before a question with it", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("What is quorum?"));
      await act(() => result.current.ask("And to expel a member?"));
      expect(result.current.exchanges.map((turn) => turn.question)).toEqual([
        "What is quorum?",
        "And to expel a member?",
      ]);
      expect(POST.mock.calls[0]![1].body).toEqual({ question: "What is quorum?" });
      expect(POST.mock.calls[1]![1].body).toEqual({
        question: "And to expel a member?",
        history: [{ question: "What is quorum?", answer: ANSWER.text }],
      });
    });

    it("sends an answer that drew on channel messages as its question only", async () => {
      const fromChat: AskAnswer = {
        ...ANSWER,
        sources: [{ ...ANSWER.sources[0]!, kind: "chat" }],
      };
      const POST = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(streamed([{ v, type: "done", answer: fromChat }])),
        );
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("Who is driving Saturday?"));
      await act(() => result.current.ask("What time?"));
      expect(POST.mock.calls[1]![1].body.history).toEqual([
        { question: "Who is driving Saturday?", answer: "" },
      ]);
    });

    it("asks for a card only when the screen says it shows them, and holds the card on its turn", async () => {
      const POST = vi
        .fn()
        .mockResolvedValue(streamed([{ v, type: "proposal", act: UNCLEAR }]));
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("Give Jordan points", { actions: true }));
      expect(POST.mock.calls[0]![1].body).toEqual({
        question: "Give Jordan points",
        actions: true,
      });
      const [turn] = result.current.exchanges;
      expect(turn).toMatchObject({ phase: "done", answer: null, proposal: UNCLEAR });

      // The card ends; its turn says how, and the next question carries the
      // member's words from it and no answer.
      act(() =>
        result.current.resolveProposal(turn!.id, {
          kind: "done",
          line: "Task created",
          page: "tasks",
        }),
      );
      expect(result.current.exchanges[0]!.resolution).toEqual({
        kind: "done",
        line: "Task created",
        page: "tasks",
      });
      POST.mockResolvedValue(streamed([{ v, type: "done", answer: ANSWER }]));
      await act(() => result.current.ask("5, for cleaning"));
      expect(POST.mock.calls[1]![1].body.history).toEqual([
        { question: "Give Jordan points", answer: "" },
      ]);
    });

    it("swaps a turn's proposal for the one an event pick answers with", async () => {
      const POST = vi
        .fn()
        .mockResolvedValue(streamed([{ v, type: "proposal", act: UNCLEAR }]));
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("Give points", { actions: true }));
      const picked = { ...UNCLEAR, status: "proposed" };
      act(() =>
        result.current.setProposal(result.current.exchanges[0]!.id, picked as never),
      );
      expect(result.current.exchanges[0]!.proposal).toEqual(picked);
    });

    it("leaves a failed turn out of what it sends, and retries it in place at the end", async () => {
      const POST = vi
        .fn()
        .mockResolvedValueOnce(streamed([{ v, type: "text", delta: "Quor" }]))
        .mockImplementation(() =>
          Promise.resolve(streamed([{ v, type: "done", answer: ANSWER }])),
        );
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("What is quorum?"));
      expect(result.current.exchanges[0]!.phase).toBe("failed");
      await act(() => result.current.retry(result.current.exchanges[0]!.id));
      expect(result.current.exchanges).toHaveLength(1);
      expect(result.current.exchanges[0]).toMatchObject({
        question: "What is quorum?",
        phase: "done",
      });
      expect(POST.mock.calls[1]![1].body).toEqual({ question: "What is quorum?" });
    });

    it("shows the question at once, then ends the turn without a request when the gate says no", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      let release: (agreed: boolean) => void = () => undefined;
      const gate = () => new Promise<boolean>((resolve) => (release = resolve));
      let asking: Promise<void> = Promise.resolve();
      act(() => {
        asking = result.current.ask("What is quorum?", { gate });
      });
      expect(result.current.exchanges[0]).toMatchObject({
        question: "What is quorum?",
        phase: "working",
      });
      expect(result.current.working).toBe(true);
      await act(async () => {
        release(false);
        await asking;
      });
      expect(POST).not.toHaveBeenCalled();
      expect(result.current.exchanges[0]).toMatchObject({
        phase: "done",
        answer: { status: "unavailable", reason: "consent_required" },
      });
      // A turn that never reached the server is not part of the conversation sent.
      await act(() => result.current.ask("What is quorum?"));
      expect(POST.mock.calls[0]![1].body).toEqual({ question: "What is quorum?" });
    });

    it("fails the turn in words when the gate itself breaks", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() =>
        result.current.ask("What is quorum?", {
          gate: () => Promise.reject(new Error("offline")),
        }),
      );
      expect(POST).not.toHaveBeenCalled();
      expect(result.current.exchanges[0]!.phase).toBe("failed");
    });

    it("stop takes the waiting turn away and keeps the rest; reset starts over", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("What is quorum?"));
      POST.mockImplementationOnce(() => new Promise(() => undefined));
      act(() => {
        void result.current.ask("And to expel a member?");
      });
      expect(result.current.exchanges).toHaveLength(2);
      act(() => result.current.stop());
      expect(result.current.exchanges.map((turn) => turn.question)).toEqual([
        "What is quorum?",
      ]);
      act(() => result.current.reset());
      expect(result.current.exchanges).toEqual([]);
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
    expect(POST.mock.calls[1]![1].body).toMatchObject({
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
    expect(result.current.exchanges[0]).toMatchObject({
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
    expect(result.current.exchanges[0]).toMatchObject({
      phase: "failed",
      preview: "",
      failure: { message: ASK_COPY.failed, retryable: true },
    });
  });

  it("fails in words when the request never connects", async () => {
    const POST = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("What is quorum?"));
    expect(result.current.exchanges[0]?.phase).toBe("failed");
  });

  it("asks nothing for an empty question", async () => {
    const POST = vi.fn();
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("   "));
    expect(POST).not.toHaveBeenCalled();
    expect(result.current.exchanges).toEqual([]);
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
