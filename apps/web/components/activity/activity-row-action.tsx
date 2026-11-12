"use client";

import { useRef, useState } from "react";
import {
  TASK_ACTION_LABELS,
  useConfirmTask,
  type ActivityRow,
  type ActivityRowAction as RowAction,
} from "@repo/hooks";
import { TASK_CONFIRM_FAILURE } from "@/components/chat/renderers/task-card";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { useServiceReview } from "@/components/service/use-service-review";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { rowActionGateProps } from "./activity-row-action-gate";

const LABELS: Record<RowAction, string> = {
  confirm: TASK_ACTION_LABELS.confirm,
  approve: "Approve",
};

/**
 * A row's ask as a button where the ask was drawn (#4402): Confirm a
 * completed task or Approve service hours in one press, as GitHub's
 * notifications and Slack's Activity put quick actions on the row.
 * Everything else (Reject, a send-back, a vote, a check-in) is still the
 * row's panel.
 *
 * Each calls what the panel calls, with the panel's words: the task card's
 * `useConfirmTask` and failure copy, the Service hours review's `approve`.
 * The page draws this only while the chapter's plan allows those writes
 * (`activityRowActionGate`); offline or still loading the chapter, it is
 * disabled with the gate's reason.
 *
 * Once the write lands the button stays disabled: the row leaves Needs you
 * on the page's re-read, and a second press before then would be refused
 * as a repeat. `onActed` re-reads and resolves when that read settles, and
 * focus then moves to the row after this one (or before it, at the end of a
 * list), so a keyboard user carries on down the list instead of starting
 * again from the top of the page.
 */
export function ActivityRowActionButton({
  row,
  action,
  gate,
  onActed,
}: {
  row: ActivityRow;
  action: RowAction;
  gate: SubscriptionGate;
  onActed: (row: ActivityRow) => Promise<unknown>;
}) {
  const confirmTask = useConfirmTask();
  const review = useServiceReview();
  const { toast } = useToast();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const ref = useRef<HTMLButtonElement>(null);

  async function act(): Promise<boolean> {
    if (action === "confirm" && row.kind === "task") {
      try {
        await confirmTask.mutateAsync(row.task.id);
        return true;
      } catch (error) {
        toast({
          title: TASK_CONFIRM_FAILURE.title,
          description: getErrorMessage(error, TASK_CONFIRM_FAILURE.fallback),
          variant: "destructive",
        });
        return false;
      }
    }
    if (action === "approve" && row.kind === "hours") {
      // Toasts its own outcome; `false` is a refusal it has already said.
      return review.approve(row.entry);
    }
    return false;
  }

  async function run() {
    setState("busy");
    // Where focus goes once this row has gone: the next row's own button,
    // which keeps its node across the re-read, or the previous one.
    const item = ref.current?.closest("li");
    const neighbour = (item?.nextElementSibling ?? item?.previousElementSibling)
      ?.firstElementChild as HTMLElement | null | undefined;
    if (!(await act())) {
      setState("idle");
      return;
    }
    setState("done");
    const hadFocus = document.activeElement === ref.current;
    await onActed(row);
    if (hadFocus && neighbour?.isConnected && !ref.current?.isConnected) {
      neighbour.focus();
    }
  }

  const label = LABELS[action];
  return (
    <Button
      ref={ref}
      type="button"
      variant="tinted"
      size="sm"
      className="pointer-events-auto h-7 shrink-0 px-2.5 text-caption"
      aria-label={`${label}: ${row.title}`}
      {...rowActionGateProps(gate, state !== "idle")}
      onClick={() => void run()}
    >
      {label}
    </Button>
  );
}
