"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { throwUnlessOk } from "@repo/api-sdk";
import {
  ASK_POST_COPY,
  ASK_POST_REFUSALS,
  type AskAnswer,
  type AskPostOutcome,
  type AskPostRestricted,
} from "@repo/validation";
import { errorCopy } from "./error-copy";
import { useFrappClient } from "./use-frapp-client";

/**
 * Posting an Ask Frapp answer to a channel (#4713, `spec/behavior/ai.md`
 * § Posting an answer to the channel), shared by web and mobile. One call does both halves:
 * with `confirm` false it only asks what posting would warn about, and with
 * `confirm` true it posts, when `acknowledged` names every warning. A post
 * whose warnings changed in between comes back `posted: false` with the new
 * list, for the asker to read before trying again.
 */
interface AskPostInput {
  channelId: string;
  /** The answer's `report_receipt`, as the server sent it. */
  receipt: string;
  confirm: boolean;
  /** The `key` of each warning the asker was shown. */
  acknowledged?: readonly string[];
}

function usePostAskAnswer() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["ask", "post"],
    // Posting twice writes one row, but the member presses Post themselves.
    retry: false,
    mutationFn: async (input: AskPostInput): Promise<AskPostOutcome> => {
      const result = await client.POST("/v1/ai/ask/posts", {
        body: {
          channel_id: input.channelId,
          receipt: input.receipt,
          confirm: input.confirm,
          ...(input.acknowledged
            ? { acknowledged: [...input.acknowledged] }
            : {}),
        },
      });
      throwUnlessOk(result);
      if (!result.data) throw new Error("The post route returned no body.");
      return result.data;
    },
  });
}

/** Where the asker is in posting one answer. */
export interface AskPostFlow {
  /**
   * `idle`: the action is offered. `checking`: asking what posting would
   * warn about. `confirm`: the asker is reading what will happen.
   * `posting`: sent.
   */
  stage: "idle" | "checking" | "confirm" | "posting";
  /** With `confirm`: what not everyone in the channel can open. */
  restricted: readonly AskPostRestricted[];
  /** The list changed between the check and the post; it is shown again. */
  changed: boolean;
  /** Why the last try stopped, in words to show. */
  error: string | null;
  start: () => void;
  confirm: () => void;
  cancel: () => void;
}

/**
 * The steps of posting one answer, the same on web and the phone: check,
 * show what will happen and what not everyone can open, then post. Nothing
 * is written until `confirm`, and `onPosted` runs once it has been.
 */
export function useAskPostFlow(input: {
  channelId: string;
  answer: Pick<AskAnswer, "report_receipt" | "read_chat">;
  onPosted: () => void;
}): AskPostFlow {
  const { channelId, answer, onPosted } = input;
  const { mutateAsync } = usePostAskAnswer();
  const [state, setState] =
    useState<Pick<AskPostFlow, "stage" | "restricted" | "changed" | "error">>(
      IDLE,
    );
  // A reply that lands after Cancel, or after the row is gone, changes
  // nothing.
  const run = useRef(0);
  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  const send = useCallback(
    (confirm: boolean, acknowledged: readonly AskPostRestricted[]) => {
      const receipt = answer.report_receipt;
      if (!receipt) return;
      if (answer.read_chat) {
        // Known without asking: the server refuses these the same way.
        setState({
          ...IDLE,
          error: ASK_POST_REFUSALS["ai.ask.post.read_chat"],
        });
        return;
      }
      const mine = ++run.current;
      setState({
        stage: confirm ? "posting" : "checking",
        restricted: acknowledged,
        changed: false,
        error: null,
      });
      mutateAsync({
        channelId,
        receipt,
        confirm,
        acknowledged: acknowledged.map(({ key }) => key),
      }).then(
        (outcome) => {
          if (run.current !== mine) return;
          if (outcome.posted) {
            setState(IDLE);
            onPosted();
            return;
          }
          setState({
            stage: "confirm",
            restricted: outcome.restricted,
            changed: confirm,
            error: null,
          });
        },
        (error: unknown) => {
          if (run.current !== mine) return;
          setState({
            // A failed post keeps what the asker was reading; a failed
            // check has nothing to keep.
            stage: confirm ? "confirm" : "idle",
            restricted: confirm ? acknowledged : [],
            changed: false,
            error: errorCopy(error, ASK_POST_COPY.failed),
          });
        },
      );
    },
    [answer.report_receipt, answer.read_chat, channelId, mutateAsync, onPosted],
  );

  const start = useCallback(() => send(false, []), [send]);
  const confirm = useCallback(
    () => send(true, state.restricted),
    [send, state.restricted],
  );
  const cancel = useCallback(() => {
    run.current += 1;
    setState(IDLE);
  }, []);
  return { ...state, start, confirm, cancel };
}

const IDLE = {
  stage: "idle",
  restricted: [],
  changed: false,
  error: null,
} as const satisfies Pick<
  AskPostFlow,
  "stage" | "restricted" | "changed" | "error"
>;
