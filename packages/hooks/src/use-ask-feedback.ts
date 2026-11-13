"use client";

import { useCallback, useRef, useState } from "react";
import type { AskFeedbackRating, AskFeedbackReason } from "@repo/validation";
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
 * member never reads a rating the team did not get. Only the newest tap's
 * outcome is applied: an older one landing late changes nothing.
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

  const send = useCallback(
    (next: AskThumbsState) => {
      if (!askId) return;
      const mine = ++tap.current;
      shown.current = next;
      setState(next);
      setFailed(false);
      const path = { ask_id: askId };
      const request =
        next.rating === null
          ? client.DELETE("/v1/ai/ask/{ask_id}/feedback", { params: { path } })
          : client.PUT("/v1/ai/ask/{ask_id}/feedback", {
              params: { path },
              body: {
                rating: next.rating,
                ...(next.reason ? { reason: next.reason } : {}),
              },
            });
      void Promise.resolve(request)
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
