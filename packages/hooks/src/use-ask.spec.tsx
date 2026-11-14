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
  ASK_TURNS_ABOVE_ALL,
  AskConversationProvider,
  applyAskEvent,
  askTurnsInChannel,
  placeAskTurns,
  useAsk,
  useAskStatus,
  useAskSuggestions,
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

  it("keeps what a step says is being read, and only for that step", () => {
    const reading = applyAskEvent(WORKING, {
      v,
      type: "status",
      step: "reading",
      reads: ["events"],
      found: 2,
    });
    expect(reading).toMatchObject({
      step: "reading",
      stepDetail: { reads: ["events"], found: 2 },
    });
    const writing = applyAskEvent(reading, { v, type: "status", step: "writing" });
    expect(writing.stepDetail).toEqual({
      reads: undefined,
      found: undefined,
      label: undefined,
    });
    // The tool loop's own line for a read rides along (#4904).
    const labelled = applyAskEvent(reading, {
      v,
      type: "status",
      step: "reading",
      tool: "search_messages",
      label: "Searching #general",
    });
    expect(labelled.stepDetail?.label).toBe("Searching #general");
    expect(
      applyAskEvent(reading, { v, type: "done", answer: ANSWER }).stepDetail,
    ).toBeNull();
  });

  it("remembers what was read for the finished answer, through the steps after it", () => {
    let exchange = applyAskEvent(WORKING, {
      v,
      type: "status",
      step: "reading",
      reads: ["events"],
      found: 2,
    });
    exchange = applyAskEvent(exchange, { v, type: "status", step: "writing" });
    exchange = applyAskEvent(exchange, { v, type: "done", answer: ANSWER });
    // The step line is gone with the work; what was read stays with the turn.
    expect(exchange.stepDetail).toBeNull();
    expect(exchange.read).toEqual({ reads: ["events"], found: 2 });
    // A turn the server never named a read for has none.
    expect(
      applyAskEvent(WORKING, { v, type: "done", answer: ANSWER }).read,
    ).toBeUndefined();
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
      // Only the second leaned on an earlier turn, which is what keeps its
      // answer from being offered to a channel (#4713).
      expect(result.current.exchanges.map((turn) => turn.followedUp)).toEqual([
        undefined,
        true,
      ]);
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

    it("never asks for a card with a tapped suggestion, and marks its turn in what later questions carry", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() =>
        result.current.ask("When and where is Formal on Friday?", {
          actions: true,
          suggested: true,
        }),
      );
      // A suggestion can name a record someone else wrote: no `actions`.
      expect(POST.mock.calls[0]![1].body).toEqual({
        question: "When and where is Formal on Friday?",
      });
      expect(result.current.exchanges[0]!.suggested).toBe(true);
      await act(() => result.current.ask("Give 5 points to everyone who came", { actions: true }));
      expect(POST.mock.calls[1]![1].body).toEqual({
        question: "Give 5 points to everyone who came",
        actions: true,
        history: [
          {
            question: "When and where is Formal on Friday?",
            answer: ANSWER.text,
            suggested: true,
          },
        ],
      });
    });

    it("keeps a suggestion a suggestion when it is asked again", async () => {
      const POST = vi
        .fn()
        .mockResolvedValueOnce(
          streamed([{ v, type: "error", code: "ai.ask.failed", retryable: true }]),
        )
        .mockResolvedValue(streamed([{ v, type: "done", answer: ANSWER }]));
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() =>
        result.current.ask("When and where is Formal on Friday?", { suggested: true }),
      );
      await act(() =>
        result.current.retry(result.current.exchanges[0]!.id, { actions: true }),
      );
      expect(POST.mock.calls[1]![1].body).toEqual({
        question: "When and where is Formal on Friday?",
      });
      expect(result.current.exchanges[0]!.suggested).toBe(true);
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

    it("does not ask an earlier turn again while another is being answered: it would take that turn's place", async () => {
      const POST = vi
        .fn()
        .mockResolvedValueOnce(streamed([{ v, type: "text", delta: "Quor" }]))
        .mockImplementationOnce(() => new Promise(() => undefined));
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("What is quorum?"));
      act(() => {
        void result.current.ask("And to expel a member?");
      });
      await waitFor(() => expect(POST).toHaveBeenCalledTimes(2));
      await act(() => result.current.retry(result.current.exchanges[0]!.id));
      expect(POST).toHaveBeenCalledTimes(2);
      expect(
        result.current.exchanges.map((turn) => [turn.question, turn.phase]),
      ).toEqual([
        ["What is quorum?", "failed"],
        ["And to expel a member?", "working"],
      ]);
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
        // Nothing is searched while the AI question is open, so no step.
        step: null,
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

    it("says it is searching once the gate says yes and the question is sent, and at once with no gate", async () => {
      // A request that never comes back, so the turn stays as it was sent.
      const POST = vi.fn(() => new Promise<never>(() => undefined));
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      act(() => {
        void result.current.ask("What is quorum?", { gate: async () => true });
      });
      await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
      expect(result.current.exchanges[0]).toMatchObject({
        phase: "working",
        step: "searching",
      });
      act(() => {
        void result.current.ask("And to expel a member?");
      });
      expect(result.current.exchanges.at(-1)).toMatchObject({
        phase: "working",
        step: "searching",
      });
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

  describe("Think harder (#4904)", () => {
    const TRACED = { ...ANSWER, ask_id: "trace-1" };
    const answering = () =>
      vi.fn().mockImplementation((path: string) =>
        path === "/v1/ai/ask"
          ? Promise.resolve(streamed([{ v, type: "done", answer: TRACED }]))
          : Promise.resolve({ data: undefined, response: { ok: true } }),
      );

    it("asks the same question again in its place with more effort, and counts the tap", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("What is quorum?"));
      const first = result.current.exchanges[0]!;
      await act(() => result.current.retry(first.id, { effort: "more" }));
      const asks = POST.mock.calls.filter(([path]) => path === "/v1/ai/ask");
      expect(asks).toHaveLength(2);
      expect(asks[0]![1].body.effort).toBeUndefined();
      expect(asks[1]![1].body).toMatchObject({
        question: "What is quorum?",
        effort: "more",
      });
      expect(POST).toHaveBeenCalledWith("/v1/ai/ask/{ask_id}/signals", {
        params: { path: { ask_id: "trace-1" } },
        body: { signal: "think_harder" },
      });
      expect(result.current.exchanges).toHaveLength(1);
      expect(result.current.exchanges[0]!.effort).toBe("more");
    });

    it("answers an older turn where it stands, with only the turns before it as history", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("First?", { channelId: "c1" }));
      await act(() => result.current.ask("Second?"));
      await act(() =>
        result.current.retry(result.current.exchanges[0]!.id, { effort: "more" }),
      );
      expect(result.current.exchanges.map((turn) => turn.question)).toEqual([
        "First?",
        "Second?",
      ]);
      const harder = POST.mock.calls.filter(([path]) => path === "/v1/ai/ask")[2]![1].body;
      expect(harder.question).toBe("First?");
      expect(harder.history).toBeUndefined();
      // Still the conversation's first question, so still one a channel can be given.
      expect(result.current.exchanges[0]!.followedUp).toBeUndefined();
      expect(result.current.exchanges[0]!.origin?.channelId).toBe("c1");
    });

    it("counts nothing when the member declines the AI question", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("What is quorum?"));
      await act(() =>
        result.current.retry(result.current.exchanges[0]!.id, {
          effort: "more",
          gate: () => Promise.resolve(false),
        }),
      );
      expect(POST.mock.calls.filter(([path]) => path !== "/v1/ai/ask")).toHaveLength(0);
    });

    it("keeps the effort when the harder turn is asked again, without counting twice", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("What is quorum?"));
      await act(() =>
        result.current.retry(result.current.exchanges[0]!.id, { effort: "more" }),
      );
      await act(() => result.current.retry(result.current.exchanges[0]!.id));
      const asks = POST.mock.calls.filter(([path]) => path === "/v1/ai/ask");
      expect(asks[2]![1].body.effort).toBe("more");
      expect(
        POST.mock.calls.filter(([path]) => path !== "/v1/ai/ask"),
      ).toHaveLength(1);
    });
  });

  describe("asked from a channel (#4713)", () => {
    const answering = () =>
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(streamed([{ v, type: "done", answer: ANSWER }])),
        );

    it("names the chat door, and only then", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("From the screen?"));
      await act(() => result.current.ask("From a channel?", { channelId: "c1" }));
      expect(POST.mock.calls[0]![1].body).toEqual({ question: "From the screen?" });
      expect(POST.mock.calls[1]![1].body).toMatchObject({
        question: "From a channel?",
        door: "chat_private",
        from: { channel_id: "c1" },
      });
    });

    it("keeps where the turn was asked, and lists it for that channel only", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("From the screen?"));
      await act(() => result.current.ask("In general?", { channelId: "c1" }));
      await act(() =>
        result.current.ask("In rush?", { channelId: "c2", afterMessage: "m9" }),
      );
      const { exchanges } = result.current;
      expect(exchanges[0]!.origin).toBeUndefined();
      expect(exchanges[1]!.origin).toMatchObject({ channelId: "c1", after: null });
      expect(Number.isNaN(Date.parse(exchanges[1]!.origin!.at))).toBe(false);
      expect(askTurnsInChannel(exchanges, "c1").map((turn) => turn.question)).toEqual([
        "In general?",
      ]);
      expect(exchanges[2]!.origin).toMatchObject({ channelId: "c2", after: "m9" });
      expect(askTurnsInChannel(exchanges, "c3")).toEqual([]);
      expect(askTurnsInChannel(exchanges, null)).toEqual([]);
    });

    it("dismisses a turn from its channel and keeps it in the conversation", async () => {
      const POST = answering();
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("In general?", { channelId: "c1" }));
      const id = result.current.exchanges[0]!.id;
      act(() => result.current.dismissFromChannel(id));
      expect(askTurnsInChannel(result.current.exchanges, "c1")).toEqual([]);
      expect(result.current.exchanges).toHaveLength(1);
      // The next question still leans on it.
      await act(() => result.current.ask("And then?"));
      expect(POST.mock.calls[1]![1].body.history).toEqual([
        { question: "In general?", answer: ANSWER.text },
      ]);
    });

    it("asks a failed turn again in the place it was first asked", async () => {
      const POST = vi
        .fn()
        .mockResolvedValueOnce(streamed([{ v, type: "text", delta: "Quor" }]))
        .mockResolvedValueOnce(streamed([{ v, type: "done", answer: ANSWER }]));
      const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
      await act(() => result.current.ask("In general?", { channelId: "c1" }));
      const first = result.current.exchanges[0]!;
      expect(first.phase).toBe("failed");
      await act(() => result.current.retry(first.id));
      const again = result.current.exchanges[0]!;
      expect(again.phase).toBe("done");
      expect(again.origin).toEqual(first.origin);
      expect(POST.mock.calls[1]![1].body.door).toBe("chat_private");
    });
  });

  describe("placeAskTurns (#4713)", () => {
    const rows = [
      { key: "m1", at: "2026-11-13T10:00:00.000Z" },
      { key: "m2", at: "2026-11-13T10:05:00.000Z" },
      { key: "m3", at: "2026-11-13T10:10:00.000Z" },
    ];
    const turn = (id: string, at: string, after?: string | null): AskExchange => ({
      ...WORKING,
      id,
      origin: { channelId: "c1", at, after },
    });

    it("sits under the message that was newest when it was asked", () => {
      const placed = placeAskTurns(rows, [turn("t1", "2026-11-13T09:00:00.000Z", "m2")]);
      expect([...placed.keys()]).toEqual(["m2"]);
    });

    it("falls back to the time when that message is not in the list", () => {
      const placed = placeAskTurns(rows, [
        turn("t1", "2026-11-13T10:07:00.000Z", "gone"),
        turn("t2", "2026-11-13T10:07:30.000Z", null),
      ]);
      expect(placed.get("m2")?.map((t) => t.id)).toEqual(["t1", "t2"]);
    });

    it("sits above every row when it is older than all of them, or there are none", () => {
      expect([
        ...placeAskTurns(rows, [turn("t1", "2026-11-13T09:00:00.000Z")]).keys(),
      ]).toEqual([ASK_TURNS_ABOVE_ALL]);
      expect([
        ...placeAskTurns([], [turn("t1", "2026-11-13T09:00:00.000Z", "m1")]).keys(),
      ]).toEqual([ASK_TURNS_ABOVE_ALL]);
    });

    it("stays under its message when newer ones arrive", () => {
      const asked = [turn("t1", "2026-11-13T10:10:01.000Z", "m3")];
      const later = [...rows, { key: "m4", at: "2026-11-13T10:11:00.000Z" }];
      expect([...placeAskTurns(later, asked).keys()]).toEqual(["m3"]);
    });

    it("ignores a turn that was not asked from a channel", () => {
      expect(placeAskTurns(rows, [WORKING]).size).toBe(0);
    });
  });

  describe("AskConversationProvider (#4713)", () => {
    it("starts over when the member or the chapter changes", async () => {
      const POST = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(streamed([{ v, type: "done", answer: ANSWER }])),
        );
      const Outer = wrapper({ POST });
      let scope = "user-1:chapter-1";
      const Shared = ({ children }: { children: React.ReactNode }) => (
        <Outer>
          <AskConversationProvider scope={scope}>{children}</AskConversationProvider>
        </Outer>
      );
      const { result, rerender } = renderHook(() => useAsk(), { wrapper: Shared });
      await act(() => result.current.ask("Mine?"));
      rerender();
      expect(result.current.exchanges).toHaveLength(1);
      scope = "user-1:chapter-2";
      rerender();
      await waitFor(() => expect(result.current.exchanges).toEqual([]));
    });

    it("is one conversation for every caller under it", async () => {
      const POST = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(streamed([{ v, type: "done", answer: ANSWER }])),
        );
      const Outer = wrapper({ POST });
      const Shared = ({ children }: { children: React.ReactNode }) => (
        <Outer>
          <AskConversationProvider>{children}</AskConversationProvider>
        </Outer>
      );
      const { result } = renderHook(
        () => ({ screen: useAsk(), channel: useAsk() }),
        { wrapper: Shared },
      );
      await act(() => result.current.channel.ask("In general?", { channelId: "c1" }));
      expect(result.current.screen.exchanges.map((turn) => turn.question)).toEqual([
        "In general?",
      ]);
      act(() => result.current.screen.reset());
      expect(result.current.channel.exchanges).toEqual([]);
    });

    it("with no provider, each caller holds its own, as before", async () => {
      const POST = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(streamed([{ v, type: "done", answer: ANSWER }])),
        );
      const { result } = renderHook(
        () => ({ one: useAsk(), two: useAsk() }),
        { wrapper: wrapper({ POST }) },
      );
      await act(() => result.current.one.ask("Mine?"));
      expect(result.current.one.exchanges).toHaveLength(1);
      expect(result.current.two.exchanges).toEqual([]);
    });
  });

  it("asks nothing for an empty question", async () => {
    const POST = vi.fn();
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper({ POST }) });
    await act(() => result.current.ask("   "));
    expect(POST).not.toHaveBeenCalled();
    expect(result.current.exchanges).toEqual([]);
  });

  describe("the opening suggestions", () => {
    const ok = (data: unknown) => ({
      data,
      error: undefined,
      response: { status: 200, ok: true },
    });

    it("reads what the server built for this member", async () => {
      const suggestions = [
        { kind: "event", text: "When and where is Formal on Friday?", request: false },
      ];
      const GET = vi.fn().mockResolvedValue(ok({ suggestions }));
      const { result } = renderHook(() => useAskSuggestions(), {
        wrapper: wrapper({ GET }),
      });
      // Nothing to show while it loads: the screen opens plain.
      expect(result.current.suggestions).toEqual([]);
      await waitFor(() => expect(result.current.suggestions).toEqual(suggestions));
      expect(GET).toHaveBeenCalledWith("/v1/ai/ask/suggestions");
    });

    it("shows nothing while a reopened screen reads again, so rows never swap in place", async () => {
      const first = [
        { kind: "tasks", text: 'When is my task "Book the hall" due?', request: false },
        { kind: "points", text: "How many points do I have this semester?", request: false },
      ];
      const second = [first[1]];
      let release: (value: unknown) => void = () => {};
      const GET = vi
        .fn()
        .mockResolvedValueOnce(ok({ suggestions: first }))
        .mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => useAskSuggestions({ enabled }),
        { wrapper: wrapper({ GET }), initialProps: { enabled: true } },
      );
      await waitFor(() => expect(result.current.suggestions).toEqual(first));
      // Closed, and the list has gone stale by the time it is opened again.
      rerender({ enabled: false });
      queryClient.invalidateQueries({ refetchType: "none" });
      rerender({ enabled: true });
      await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));
      // The old rows are not shown while the new ones are on their way.
      expect(result.current.suggestions).toEqual([]);
      release(ok({ suggestions: second }));
      await waitFor(() => expect(result.current.suggestions).toEqual(second));
    });

    it("does not read until the screen is open", () => {
      const GET = vi.fn();
      renderHook(() => useAskSuggestions({ enabled: false }), {
        wrapper: wrapper({ GET }),
      });
      expect(GET).not.toHaveBeenCalled();
    });

    it.each([
      ["AI is off", refusedWith({ statusCode: 404, code: "ai.not_available" })],
      ["the read fails", refusedWith({ statusCode: 500 })],
    ])("shows none when %s", async (_name, answer) => {
      const GET = vi.fn().mockResolvedValue(answer);
      const { result } = renderHook(() => useAskSuggestions(), {
        wrapper: wrapper({ GET }),
      });
      await waitFor(() => expect(GET).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(result.current.suggestions).toEqual([]);
    });
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
