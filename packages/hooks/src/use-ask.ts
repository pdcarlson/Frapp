"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codeOf, throwUnlessOk, type components } from "@repo/api-sdk";
import {
  ASK_COPY,
  askHistory,
  createAskStreamReader,
  type AskAnswer,
  type AskStreamEvent,
} from "@repo/validation";
import { errorCopy } from "./error-copy";
import type { ActResponse } from "./use-act";
import { aiConsentKey, isAiNotAvailable } from "./use-ai";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Ask Frapp on the client (#450, #451, `spec/behavior/ai.md`), shared by web
 * and, when its slice comes, mobile.
 *
 * The answer arrives as a stream of events whose format lives in
 * `@repo/validation` (`ask.ts`). What this module adds is the reading: the
 * step the server is on, the text as it is written, and then the checked
 * answer, which replaces what streamed, or the proposal card the member's
 * words asked for.
 *
 * It also holds the conversation (`ai.md` § One conversation): every turn of
 * this sitting, in order. The server keeps nothing between questions, so the
 * turns before a question are sent with it (`askHistory`). The conversation
 * lives as long as the screen that holds this hook, and is gone on reload.
 */

/** `GET /v1/ai/ask`: whether exchanges are being kept, and who may change that. */
export type AskStatus = components["schemas"]["AskStatusDto"];

const askStatusKey = (chapterId: string | null | undefined) =>
  ["ai", "ask", "status", chapterId] as const;

/**
 * What Ask needs before the first question, or `null` when the server has no
 * AI. Read again each time the panel opens (`staleTime` is short): the
 * "answers are being saved" line has to be true at the moment of asking.
 */
export function useAskStatus(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: askStatusKey(chapterId),
    queryFn: async (): Promise<AskStatus | null> => {
      const result = await client.GET("/v1/ai/ask");
      if (isAiNotAvailable(result.error)) return null;
      throwUnlessOk(result);
      if (result.data === undefined) {
        throw new Error("The Ask route returned no body.");
      }
      return result.data;
    },
    staleTime: 30_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/**
 * The president turning the beta diagnostics window on (`on: true`) or off.
 * The server's answer is written into the cached status, so the settings row
 * and Ask's "being saved" line change together.
 */
export function useSetAskDiagnostics() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["ai-ask", "diagnostics"],
    retry: false,
    mutationFn: async (on: boolean) => {
      const result = on
        ? await client.POST("/v1/ai/ask/diagnostics")
        : await client.DELETE("/v1/ai/ask/diagnostics");
      throwUnlessOk(result);
      if (result.data === undefined) {
        throw new Error("The Ask route returned no body.");
      }
      return result.data;
    },
    onSuccess: (diagnostics) => {
      queryClient.setQueryData(
        askStatusKey(chapterId),
        (): AskStatus => ({ saved_until: diagnostics.ends_at, diagnostics }),
      );
    },
    onError: () => {
      // Already on in another tab, or the presidency moved: read it again.
      void queryClient.invalidateQueries({ queryKey: askStatusKey(chapterId) });
    },
  });
}

/** How a proposal card ended, so its turn can say so in the card's place. */
export type AskProposalResolution =
  | {
      kind: "done";
      /** "Task created", "Gave 5 points to 12 members". */
      line: string;
      /** The page the change can be seen on, or null for none. Open. */
      page: string | null;
    }
  | { kind: "cancelled" };

/** One turn: what the member typed and what has come back for it so far. */
export interface AskExchange {
  /** This turn's place in the conversation: a list key, and what the turn's changes name. */
  id: string;
  question: string;
  /**
   * The server's id for this ask, from the stream's `start` event: what
   * "Report this" names (#4315). Null until the stream begins.
   */
  askId?: string | null;
  /** `working` until the server's `done`; `failed` when no answer arrived. */
  phase: "working" | "done" | "failed";
  /** The step the server last named, while working. Open on the wire. */
  step: string | null;
  /** The text as it streams. A preview: `answer` replaces it. */
  preview: string;
  answer: AskAnswer | null;
  /**
   * The member asked for something to be done: the card, the choice of
   * event, or what was left unsaid, in place of an answer. Nothing has
   * changed until the card is confirmed.
   */
  proposal: ActResponse | null;
  /** Set once the proposal was confirmed or dismissed. */
  resolution: AskProposalResolution | null;
  /** Why it failed, in words to show, and whether asking again may work. */
  failure: { message: string; retryable: boolean } | null;
}

/** An answer no stream was opened for: the server refused before it began. */
function unavailable(reason: string): AskAnswer {
  return {
    status: "unavailable",
    reason,
    text: "",
    citations: [],
    sources: [],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  };
}

/** The pre-stream refusals a client acts on, as the answer they amount to. */
const REFUSAL_REASONS: Record<string, string> = {
  "ai.consent.required": "consent_required",
  "ai.chapter_off": "chapter_off",
  "ai.not_available": "not_available",
};

/** The exchange after one stream event. Pure, so it is tested without a stream. */
export function applyAskEvent(
  exchange: AskExchange,
  event: AskStreamEvent,
): AskExchange {
  // `done`, `proposal` and `error` are final: a late delta never reopens a turn.
  if (exchange.phase !== "working") return exchange;
  switch (event.type) {
    case "start":
      return { ...exchange, askId: event.ask_id };
    case "status":
      return { ...exchange, step: event.step };
    case "text":
      return { ...exchange, preview: exchange.preview + event.delta };
    case "done":
      return {
        ...exchange,
        phase: "done",
        step: null,
        preview: "",
        answer: event.answer,
      };
    case "proposal":
      return {
        ...exchange,
        phase: "done",
        step: null,
        preview: "",
        // The shape `POST /v1/ai/act` answers with; open on the wire, and
        // the card shows a status it does not know as the generic line.
        proposal: event.act as unknown as ActResponse,
      };
    case "error":
      // Nothing shown so far stands (`ask.ts`), so the preview goes too.
      return {
        ...exchange,
        phase: "failed",
        step: null,
        preview: "",
        failure: { message: ASK_COPY.failed, retryable: event.retryable },
      };
  }
}

function failed(exchange: AskExchange, message: string): AskExchange {
  return {
    ...exchange,
    phase: "failed",
    step: null,
    preview: "",
    failure: { message, retryable: true },
  };
}

/**
 * What is sent as the conversation before a new question: the turns that
 * finished, oldest first. A turn that failed or never reached the server
 * said nothing worth carrying.
 */
export function askHistoryOf(exchanges: readonly AskExchange[]) {
  return askHistory(
    exchanges
      .filter(
        (exchange) =>
          exchange.phase === "done" &&
          exchange.answer?.status !== "unavailable",
      )
      .map(({ question, answer }) => ({ question, answer })),
  );
}

export interface AskOptions {
  /** The "answers are being saved" line was on screen (`ask.ts`). */
  savedNoticeShown?: boolean;
  /** This screen shows proposal cards, and the member may have Frapp act. */
  actions?: boolean;
  /**
   * Runs after the question is on screen and before it is sent: the AI
   * sheet's gate. False ends the turn as "answer the AI question first"; a
   * throw ends it as a failure to try again.
   */
  gate?: () => Promise<boolean>;
}

let nextExchange = 0;

/**
 * Asks, and holds the conversation on screen.
 *
 * `ask` adds a turn and resolves when it is over, however it ended; it never
 * rejects. `retry` asks a failed turn's question again in its place at the
 * end. `stop` abandons the question in flight and takes its turn away
 * (closing the panel), and `reset` starts a new conversation.
 */
export function useAsk(): {
  exchanges: AskExchange[];
  /** A turn is waiting on the server. */
  working: boolean;
  ask: (question: string, options?: AskOptions) => Promise<void>;
  retry: (id: string, options?: AskOptions) => Promise<void>;
  /** Replaces a turn's proposal: the event picked for "everyone who came". */
  setProposal: (id: string, proposal: ActResponse) => void;
  /** Records that a turn's card was confirmed or dismissed. */
  resolveProposal: (id: string, resolution: AskProposalResolution) => void;
  stop: () => void;
  reset: () => void;
} {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const [exchanges, setExchanges] = useState<AskExchange[]>([]);
  // What `ask` reads the conversation from: state as of the last render is a
  // turn behind when two calls land in one tick.
  const latest = useRef<AskExchange[]>([]);
  const inFlight = useRef<AbortController | null>(null);

  const write = useCallback(
    (change: (current: AskExchange[]) => AskExchange[]) => {
      latest.current = change(latest.current);
      setExchanges(latest.current);
    },
    [],
  );

  const stop = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    if (latest.current.some((exchange) => exchange.phase === "working")) {
      write((current) =>
        current.filter((exchange) => exchange.phase !== "working"),
      );
    }
  }, [write]);

  const reset = useCallback(() => {
    stop();
    write(() => []);
  }, [stop, write]);

  // A screen that unmounts mid-answer stops paying for the rest of it.
  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
    },
    [],
  );

  const patch = useCallback(
    (id: string, change: (current: AskExchange) => AskExchange) => {
      write((current) =>
        current.map((exchange) =>
          exchange.id === id ? change(exchange) : exchange,
        ),
      );
    },
    [write],
  );

  const run = useCallback(
    async (question: string, options: AskOptions | undefined, drop?: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      // One question at a time: a turn still waiting is abandoned.
      stop();
      const abort = new AbortController();
      inFlight.current = abort;
      const id = `turn-${(nextExchange += 1)}`;
      const earlier = latest.current.filter((exchange) => exchange.id !== drop);
      const history = askHistoryOf(earlier);
      /** Applies a change unless this turn was abandoned. */
      const update = (change: (current: AskExchange) => AskExchange) => {
        if (inFlight.current === abort) patch(id, change);
      };

      write(() => [
        ...earlier,
        {
          id,
          question: trimmed,
          phase: "working",
          step: "searching",
          preview: "",
          answer: null,
          proposal: null,
          resolution: null,
          failure: null,
        },
      ]);

      try {
        if (options?.gate) {
          let agreed: boolean;
          try {
            agreed = await options.gate();
          } catch (error) {
            update((current) =>
              failed(current, errorCopy(error, ASK_COPY.failed)),
            );
            return;
          }
          if (!agreed) {
            update((current) => ({
              ...current,
              phase: "done",
              step: null,
              answer: unavailable("consent_required"),
            }));
            return;
          }
          if (abort.signal.aborted) return;
        }
        const result = await client.POST("/v1/ai/ask", {
          body: {
            question: trimmed,
            ...(history.length > 0 ? { history } : {}),
            ...(options?.actions ? { actions: true } : {}),
            ...(options?.savedNoticeShown ? { saved_notice_shown: true } : {}),
          },
          parseAs: "stream",
          signal: abort.signal,
        });
        if (result.error !== undefined || !result.response.ok) {
          const reason = REFUSAL_REASONS[codeOf(result.error) ?? ""];
          if (reason === "consent_required") {
            // The server says the member has not said yes, so what this
            // client holds is out of date (a No on another device, or a new
            // sheet). Read it again, so the way back opens the sheet.
            await queryClient.invalidateQueries({ queryKey: aiConsentKey });
          }
          update((current) =>
            reason
              ? { ...current, phase: "done", step: null, answer: unavailable(reason) }
              : failed(current, errorCopy(result.error, ASK_COPY.failed)),
          );
          return;
        }
        const body = result.data as ReadableStream<Uint8Array> | null | undefined;
        if (!body) {
          update((current) => failed(current, ASK_COPY.failed));
          return;
        }

        const reader = body.getReader();
        const decoder = new TextDecoder();
        const frames = createAskStreamReader();
        let ended = false;
        while (!ended) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of frames.feed(decoder.decode(value, { stream: true }))) {
            update((current) => applyAskEvent(current, event));
            if (
              event.type === "done" ||
              event.type === "proposal" ||
              event.type === "error"
            ) {
              ended = true;
            }
          }
        }
        if (ended) {
          void reader.cancel().catch(() => undefined);
        } else {
          // The connection closed before the server said how it ended.
          update((current) => failed(current, ASK_COPY.failed));
        }
      } catch {
        // An abort is this hook's own doing; anything else is the network.
        if (!abort.signal.aborted) {
          update((current) => failed(current, ASK_COPY.failed));
        }
      } finally {
        if (inFlight.current === abort) inFlight.current = null;
      }
    },
    [client, patch, queryClient, stop, write],
  );

  const ask = useCallback(
    (question: string, options?: AskOptions) => run(question, options),
    [run],
  );

  const retry = useCallback(
    (id: string, options?: AskOptions) => {
      const again = latest.current.find((exchange) => exchange.id === id);
      return again ? run(again.question, options, id) : Promise.resolve();
    },
    [run],
  );

  const setProposal = useCallback(
    (id: string, proposal: ActResponse) =>
      patch(id, (current) => ({ ...current, proposal, resolution: null })),
    [patch],
  );

  const resolveProposal = useCallback(
    (id: string, resolution: AskProposalResolution) =>
      patch(id, (current) => ({ ...current, resolution })),
    [patch],
  );

  return {
    exchanges,
    working: exchanges.some((exchange) => exchange.phase === "working"),
    ask,
    retry,
    setProposal,
    resolveProposal,
    stop,
    reset,
  };
}
