import { useEffect, useRef } from "react";
import type { JumpMissReason } from "./use-jump-to-important";

/**
 * How long a missed focus waits for the conversation's catch-up read before
 * it says the message couldn't be opened.
 */
export const FOCUS_RETRY_WINDOW_MS = 4_000;

type Jump = (
  messageId: string,
  options?: { onMiss?: (reason: JumpMissReason) => void },
) => void;

/**
 * Opens a channel on the message a route names (`focusMessageId`): a push or
 * in-app row about one message (#4977), a reminder (#4957), an Activity row
 * (#3926). Once per message, after the first rows are in.
 *
 * A channel paints its cached rows at once and catches up after (the realtime
 * join's backfill), so a push about a message newer than the cache can miss on
 * the first try. A miss that isn't an error therefore waits up to
 * {@link FOCUS_RETRY_WINDOW_MS} for the rows to change and tries once more;
 * only a second miss, or no change in that time, reaches `onMiss`.
 */
export function useFocusOnOpen({
  focusMessageId,
  rowCount,
  jump,
  onMiss,
}: {
  focusMessageId: string | null;
  rowCount: number;
  jump: Jump;
  onMiss: (reason: JumpMissReason) => void;
}): void {
  const focusedOn = useRef<string | null>(null);
  const retry = useRef<{
    id: string;
    rowCount: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const latest = useRef({ jump, onMiss, rowCount });
  useEffect(() => {
    latest.current = { jump, onMiss, rowCount };
  }, [jump, onMiss, rowCount]);

  useEffect(() => {
    if (!focusMessageId || focusedOn.current === focusMessageId) return;
    if (rowCount === 0) return;
    focusedOn.current = focusMessageId;
    if (retry.current) clearTimeout(retry.current.timer);
    retry.current = null;
    const id = focusMessageId;
    latest.current.jump(id, {
      onMiss: (reason) => {
        if (reason === "error") {
          latest.current.onMiss(reason);
          return;
        }
        retry.current = {
          id,
          rowCount: latest.current.rowCount,
          timer: setTimeout(() => {
            if (retry.current?.id !== id) return;
            retry.current = null;
            latest.current.onMiss(reason);
          }, FOCUS_RETRY_WINDOW_MS),
        };
      },
    });
  }, [focusMessageId, rowCount]);

  // The rows changed while a miss waited: the catch-up landed, so try again,
  // this time for good.
  useEffect(() => {
    const pending = retry.current;
    if (!pending || pending.rowCount === rowCount) return;
    clearTimeout(pending.timer);
    retry.current = null;
    latest.current.jump(pending.id, { onMiss: latest.current.onMiss });
  }, [rowCount]);

  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current.timer);
    },
    [],
  );
}
