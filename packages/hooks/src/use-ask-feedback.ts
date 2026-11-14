"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AskFeedbackRating,
  AskFeedbackReason,
  AskSignal,
} from "@repo/validation";
import { throwUnlessOk } from "@repo/api-sdk";
import { useFrappClient } from "./use-frapp-client";

/** A member's thumbs on one answer, as the clients draw it. */
export interface AskThumbsState {
  rating: AskFeedbackRating | null;
  /** With a down only. */
  reason: AskFeedbackReason | null;
}

const NONE: AskThumbsState = { rating: null, reason: null };

/**
 * The thumbs under one Ask answer (#4902, drawn by #4904;
 * `spec/behavior/ai.md` § Feedback on an answer): the state both clients
 * draw and the three things a member can do with it.
 *
 * - `rate` sets a thumb; the same thumb again takes it back; the other one
 *   changes it. A change of thumb drops the reason.
 * - `giveReason` says why a down, and may follow it.
 *
 * A tap shows at once and is sent after. If the send fails the thumbs go back
 * to what the server last took and `failed` is set until the next tap, so a
 * member never reads a rating the team did not get. Taps are sent one after
 * another, in the order they were made, so the server ends on the last one
 * and "what the server last took" is never an older tap landing late. Only
 * the newest tap's failure is shown: an older one failing changes nothing.
 *
 * It sends a rating and a reason against the answer's id, never a word of
 * the question or the answer. It is kept for as long as the answer stays on
 * screen; nothing is read back from the server.
 */
export function useAskThumbs(askId: string | null | undefined): {
  state: AskThumbsState;
  failed: boolean;
  rate: (rating: AskFeedbackRating) => void;
  giveReason: (reason: AskFeedbackReason) => void;
} {
  const client = useFrappClient();
  const [state, setState] = useState<AskThumbsState>(NONE);
  const [failed, setFailed] = useState(false);
  // What the server last took, to fall back to; and which tap is newest.
  const taken = useRef<AskThumbsState>(NONE);
  const shown = useRef<AskThumbsState>(NONE);
  const tap = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const send = useCallback(
    (next: AskThumbsState) => {
      if (!askId) return;
      const mine = ++tap.current;
      shown.current = next;
      setState(next);
      setFailed(false);
      const path = { ask_id: askId };
      const request = () =>
        next.rating === null
          ? client.DELETE("/v1/ai/ask/{ask_id}/feedback", { params: { path } })
          : client.PUT("/v1/ai/ask/{ask_id}/feedback", {
              params: { path },
              body: {
                rating: next.rating,
                ...(next.reason ? { reason: next.reason } : {}),
              },
            });
      queue.current = queue.current
        .then(() => request())
        .then((result) => throwUnlessOk(result))
        .then(
          () => {
            taken.current = next;
          },
          () => {
            if (mine !== tap.current) return;
            shown.current = taken.current;
            setState(taken.current);
            setFailed(true);
          },
        );
    },
    [askId, client],
  );

  const rate = useCallback(
    (rating: AskFeedbackRating) =>
      send(shown.current.rating === rating ? NONE : { rating, reason: null }),
    [send],
  );
  const giveReason = useCallback(
    (reason: AskFeedbackReason) => send({ rating: "down", reason }),
    [send],
  );

  return { state, failed, rate, giveReason };
}

/**
 * Counts a tap under an Ask answer (`ASK_SIGNALS`; `spec/behavior/ai.md`
 * § Feedback on an answer): one word against the answer's id, never a word
 * of the answer. Sent and forgotten: a count that does not arrive changes
 * nothing the member sees, so a failure is dropped. Nothing is sent for an
 * answer with no kept trace (`askId` empty).
 */
export function useAskSignal(): (
  askId: string | null | undefined,
  signal: AskSignal,
) => void {
  const client = useFrappClient();
  return useCallback(
    (askId, signal) => {
      if (!askId) return;
      void Promise.resolve()
        .then(() =>
          client.POST("/v1/ai/ask/{ask_id}/signals", {
            params: { path: { ask_id: askId } },
            body: { signal },
          }),
        )
        .catch(() => undefined);
    },
    [client],
  );
}
