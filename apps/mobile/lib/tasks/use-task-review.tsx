import { useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { useConfirmTask, useRejectTask } from "@repo/hooks";
import {
  useCardWrite,
  type CardRefusal,
} from "@/components/chat/use-card-write";
import {
  SendBackSheet,
  sendBackDraftKey,
} from "@/components/tasks/send-back-sheet";
import { successHaptic } from "@/lib/haptics";
import type { TaskRowModel } from "@/lib/tasks/board";
import {
  TASK_CONFIRM_FAILURE,
  taskStatusGateRefusal,
} from "@/lib/tasks/status-refusal";

/** Said once a Confirm lands, and once a Send back does. */
export const CONFIRMED_LINE = "Confirmed.";
export const SENT_BACK_LINE = "Sent back.";

export interface TaskReview {
  /** Confirm a completion (`POST /v1/tasks/:id/confirm`). */
  confirm: (row: TaskRowModel) => void;
  /** Opens Send back's sheet, which takes the reason (`/reject`). */
  sendBack: (row: TaskRowModel) => void;
  /** A refused Confirm or Send back; a gate's withdraws both (`gate`). */
  refusal: CardRefusal | null;
  /**
   * `refusal` when Confirm's: Send back's sheet says its own, so a host
   * with no line of its own (a row's menu) alerts only this one.
   */
  confirmRefusal: CardRefusal | null;
  /** Offline, mid-write, or after a gate refusal. */
  disabled: boolean;
  /** Why they are held, for their spoken hint. */
  hint: string | undefined;
  /** The task whose Confirm is sending, or `null`. */
  confirmingId: string | null;
  /** Send back's sheet while it is open; render once. */
  host: ReactNode;
}

/**
 * An officer's Confirm and Send back on a completion waiting on their
 * sign-off (#5513), for the task screen's bar and a row's long-press menu:
 * what chat's task card does with the same two (`components/chat/task-card.tsx`),
 * through the same hooks and the same refusal rule (`useCardWrite`), so
 * Activity's review sheet, which drew that card, could go.
 *
 * Confirm sends at once, as the card's does; the hooks update the task's
 * reads optimistically and re-read them as the write settles, so the screen
 * redraws Confirmed in place and the board, the Calendar and Activity follow.
 * Send back opens the card's own sheet (`SendBackSheet`): the required
 * reason, "Ask for a photo next time" on a task that doesn't already ask for
 * one, and the reason kept by task (`send-back:<id>`, #5041) and shared with
 * the card's Send back on the same task. A gate's refusal on either latches
 * as the card's does, until the officer comes back to the screen or the app.
 */
export function useTaskReview(): TaskReview {
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();
  const { refusal, act, latchGate, disabled, hint } = useCardWrite({
    gateRefusal: taskStatusGateRefusal,
    isConfirmed: true,
    pending: confirmTask.isPending || rejectTask.isPending,
  });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Set before the first await, so a second tap in the same frame neither
  // sends again nor, when it returns, clears the first one's busy state.
  const confirming = useRef(false);
  const [sendingBack, setSendingBack] = useState<TaskRowModel | null>(null);
  // Whether the refusal held is Send back's, which its sheet already says.
  const [refusedBySheet, setRefusedBySheet] = useState(false);

  const confirm = (row: TaskRowModel) => {
    if (confirming.current) return;
    confirming.current = true;
    let landed = false;
    setConfirmingId(row.id);
    setRefusedBySheet(false);
    void act(async () => {
      await confirmTask.mutateAsync(row.id);
      landed = true;
    }, TASK_CONFIRM_FAILURE).finally(() => {
      confirming.current = false;
      setConfirmingId(null);
      if (!landed) return;
      // The confirming action (`spec/ui/mobile/README.md` § Native-feel
      // rules), felt once the server holds it confirmed.
      successHaptic();
      AccessibilityInfo.announceForAccessibility(CONFIRMED_LINE);
    });
  };

  const host = sendingBack ? (
    <SendBackSheet
      key={sendingBack.id}
      // Shared with chat's task card's Send back on this task (#5041).
      keptDraft={sendBackDraftKey(sendingBack.id)}
      submittedAt={sendingBack.completedAt}
      title={sendingBack.title}
      proofKind={sendingBack.proofKind}
      onSubmit={async (body) => {
        try {
          await rejectTask.mutateAsync({ id: sendingBack.id, body });
        } catch (error) {
          // The sheet says why; a gate's also withdraws Confirm and Send
          // back, as one through `act` does.
          setRefusedBySheet(true);
          latchGate(error);
          throw error;
        }
        AccessibilityInfo.announceForAccessibility(SENT_BACK_LINE);
      }}
      onClosed={() => setSendingBack(null)}
    />
  ) : null;

  return {
    confirm,
    sendBack: setSendingBack,
    refusal,
    confirmRefusal: refusedBySheet ? null : refusal,
    disabled,
    hint,
    confirmingId,
    host,
  };
}
