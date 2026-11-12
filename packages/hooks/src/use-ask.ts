"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codeOf, throwUnlessOk, type components } from "@repo/api-sdk";
import {
  ASK_COPY,
  createAskStreamReader,
  type AskAnswer,
  type AskStreamEvent,
} from "@repo/validation";
import { errorCopy } from "./error-copy";
import { aiConsentKey, isAiNotAvailable } from "./use-ai";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Ask Frapp on the client (#450, #451, `spec/behavior/ai.md`), shared by web
 * and, when its slice comes, mobile.
 *
 * The answer arrives as a stream of events whose format lives in
 * `@repo/validation` (`ask.ts`). What this module adds is the reading: one
 * exchange at a time, the step the server is on, the text as it is written,
 * and then the checked answer, which replaces what streamed. Ask answers each
 * question on its own, so there is no conversation to keep.
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

/** One question and what has come back for it so far. */
export interface AskExchange {
  question: string;
  /** `working` until the server's `done`; `failed` when no answer arrived. */
  phase: "working" | "done" | "failed";
  /** The step the server last named, while working. Open on the wire. */
  step: string | null;
  /** The text as it streams. A preview: `answer` replaces it. */
  preview: string;
  answer: AskAnswer | null;
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
  // `done` and `error` are final: a late delta never reopens an answer.
  if (exchange.phase !== "working") return exchange;
  switch (event.type) {
    case "start":
      return exchange;
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
 * Asks, and holds the one exchange on screen.
 *
 * `ask` resolves when the exchange is over, however it ended; it never
 * rejects. `stop` abandons the question in flight (closing the panel, asking
 * another), and `reset` clears the screen.
 */
export function useAsk(): {
  exchange: AskExchange | null;
  ask: (
    question: string,
    options?: { savedNoticeShown?: boolean },
  ) => Promise<void>;
  stop: () => void;
  reset: () => void;
} {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const [exchange, setExchange] = useState<AskExchange | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setExchange(null);
  }, [stop]);

  // A panel that unmounts mid-answer stops paying for the rest of it.
  useEffect(() => stop, [stop]);

  const ask = useCallback(
    async (question: string, options?: { savedNoticeShown?: boolean }) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      stop();
      const abort = new AbortController();
      inFlight.current = abort;
      const mine = () => inFlight.current === abort;
      /** Applies a change unless a newer question replaced this one. */
      const update = (change: (current: AskExchange) => AskExchange) => {
        if (!mine()) return;
        setExchange((current) => (current ? change(current) : current));
      };

      setExchange({
        question: trimmed,
        phase: "working",
        step: "searching",
        preview: "",
        answer: null,
        failure: null,
      });

      try {
        const result = await client.POST("/v1/ai/ask", {
          body: {
            question: trimmed,
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
            if (event.type === "done" || event.type === "error") ended = true;
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
        if (mine()) inFlight.current = null;
      }
    },
    [client, queryClient, stop],
  );

  return { exchange, ask, stop, reset };
}
