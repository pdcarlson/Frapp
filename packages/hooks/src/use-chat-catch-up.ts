"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { codeOf } from "@repo/api-sdk";
import {
  CHAT_CATCH_UP_COPY,
  can,
  type ChatCatchUp,
} from "@repo/validation";
import { errorCopy } from "./error-copy";
import {
  aiAvailableFrom,
  aiConsentKey,
  useAiChapterSettings,
  useAiConsent,
} from "./use-ai";
import { useFrappClient } from "./use-frapp-client";
import { useMyPermissions } from "./use-user";

/**
 * Catch me up on the client (#3946, `spec/behavior/ai.md` § Catch me up),
 * shared by web and, when its slice comes, mobile.
 *
 * The summary is held in the screen's own state and nowhere else: not in the
 * query cache, not in storage. Nothing about it is kept on the server either,
 * so leaving the channel or reloading is the end of it.
 */

/** What to summarize: one thread, the channel since a moment, or what was new. */
export type ChatCatchUpTarget =
  | { thread_root_id: string }
  | { since: string }
  | { unread: { count: number; as_of: string } };

/** One request and what came back for it. */
export interface ChatCatchUpRun {
  channelId: string;
  target: ChatCatchUpTarget;
  phase: "working" | "done" | "failed";
  summary: ChatCatchUp | null;
  /** Why it failed, in words to show. */
  failure: string | null;
}

/**
 * Whether to offer Catch me up at all: the server has AI, the president has
 * both Ask and channel messages turned on, and the member holds `ai:use`.
 * False until every one of those is known to be true, so an entry point
 * never appears and then goes away. The member's own answer on the AI sheet
 * is asked at the first use, not here.
 */
export function useChatCatchUpAvailable(): boolean {
  const consent = useAiConsent();
  const available = aiAvailableFrom(consent) === true;
  const settings = useAiChapterSettings({ enabled: available });
  const permissions = useMyPermissions().data?.permissions;
  return (
    available &&
    settings.data?.ask === true &&
    settings.data.chat_source === true &&
    can("ai:use", permissions ?? [])
  );
}

function unavailable(reason: string): ChatCatchUp {
  return {
    status: "unavailable",
    reason,
    points: [],
    messages_read: 0,
    messages_total: 0,
    left_out_messages: 0,
    unverified_points: 0,
    covers_from: null,
    covers_to: null,
  };
}

/** The refusals a client acts on, as the summary they amount to. */
const REFUSAL_REASONS: Record<string, string> = {
  "ai.consent.required": "consent_required",
  "ai.chapter_off": "chapter_off",
  "ai.not_available": "not_available",
};

/**
 * Asks for a summary and holds the one on screen.
 *
 * `run` resolves when the request is over, however it ended; it never
 * rejects. Asking again replaces what was there, and `reset` clears it and
 * abandons a request in flight (the server then stops the model call).
 */
export function useChatCatchUp(): {
  current: ChatCatchUpRun | null;
  run: (channelId: string, target: ChatCatchUpTarget) => Promise<void>;
  reset: () => void;
} {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<ChatCatchUpRun | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setCurrent(null);
  }, [stop]);

  // A screen that unmounts mid-request stops paying for the rest of it.
  useEffect(() => stop, [stop]);

  const run = useCallback(
    async (channelId: string, target: ChatCatchUpTarget) => {
      stop();
      const abort = new AbortController();
      inFlight.current = abort;
      const started: ChatCatchUpRun = {
        channelId,
        target,
        phase: "working",
        summary: null,
        failure: null,
      };
      /** Lands a result unless a newer request replaced this one. */
      const finish = (fields: Partial<ChatCatchUpRun>) => {
        if (inFlight.current !== abort) return;
        inFlight.current = null;
        setCurrent({ ...started, ...fields });
      };
      setCurrent(started);

      try {
        const result = await client.POST("/v1/ai/catch-up", {
          body: { channel_id: channelId, ...target },
          signal: abort.signal,
        });
        if (result.error !== undefined || result.data === undefined) {
          const reason = REFUSAL_REASONS[codeOf(result.error) ?? ""];
          if (reason === "consent_required") {
            // What this client holds is out of date (a No on another device,
            // or a new sheet). Read it again, so the way back opens the sheet.
            await queryClient.invalidateQueries({ queryKey: aiConsentKey });
          }
          finish(
            reason
              ? { phase: "done", summary: unavailable(reason) }
              : {
                  phase: "failed",
                  failure: errorCopy(result.error, CHAT_CATCH_UP_COPY.failed),
                },
          );
          return;
        }
        finish({ phase: "done", summary: result.data });
      } catch (error) {
        // Abandoned on purpose: nothing to show.
        if (abort.signal.aborted) return;
        finish({
          phase: "failed",
          failure: errorCopy(error, CHAT_CATCH_UP_COPY.failed),
        });
      }
    },
    [client, queryClient, stop],
  );

  return { current, run, reset };
}
