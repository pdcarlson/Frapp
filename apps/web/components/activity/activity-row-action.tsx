"use client";

import { useState } from "react";
import {
  TASK_ACTION_LABELS,
  useConfirmTask,
  type ActivityRow,
  type ActivityRowAction as RowAction,
} from "@repo/hooks";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { useServiceReview } from "@/components/service/use-service-review";
import { Button } from "@/components/ui/button";
import { useSelfCheckIn } from "@/lib/hooks/use-self-check-in";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

const LABELS: Record<RowAction, string> = {
  confirm: TASK_ACTION_LABELS.confirm,
  approve: "Approve",
  "check-in": "Check in",
};

/**
 * A row's ask as a button beside it (#4402): Confirm a completed task,
 * Approve service hours, or Check in to an open event in one press, as
 * GitHub's notifications put Done and Slack's Activity puts its quick
 * actions on the row. Everything else (Reject, a vote, a send-back) is still
 * the row's panel.
 *
 * Each calls what the panel calls, with the panel's words: the task card's
 * `useConfirmTask`, the Service hours page's `useServiceReview`, the event
 * card's `useSelfCheckIn`. They are paid-chapter writes, so the page draws
 * this only while its subscription gate doesn't refuse them
 * (`activityRowActionGate`); refused, the row keeps its ask and opens the
 * panel, which says why. Offline or still checking, the button is disabled
 * with the gate's reason. `onActed` re-reads the page so the row leaves
 * Needs you.
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
  onActed: () => void;
}) {
  const confirmTask = useConfirmTask();
  const review = useServiceReview();
  const checkIn = useSelfCheckIn();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (action === "confirm" && row.kind === "task") {
        await confirmTask.mutateAsync(row.task.id).then(onActed, (error) =>
          toast({
            title: "Couldn't confirm task",
            description: getErrorMessage(
              error,
              "Only admins with tasks:manage can confirm completions.",
            ),
            variant: "destructive",
          }),
        );
      } else if (action === "approve" && row.kind === "hours") {
        if (await review.approve(row.entry)) onActed();
      } else if (action === "check-in" && row.kind === "event") {
        await checkIn.run(row.event.id, row.event.point_value);
        onActed();
      }
    } finally {
      setBusy(false);
    }
  }

  const label = LABELS[action];
  return (
    <Button
      type="button"
      variant="tinted"
      size="sm"
      className="h-7 shrink-0 px-2.5 text-caption"
      aria-label={`${label}: ${row.title}`}
      {...gate.controlProps(busy)}
      onClick={() => void run()}
    >
      {label}
    </Button>
  );
}

/**
 * The gate the page hands its row actions, or `null` when the chapter's plan
 * refuses these writes: then no row draws a button and each opens its panel,
 * where the subscription notice says why. Offline and still-checking are not
 * refusals; the buttons show, disabled, with the gate's reason.
 */
export function activityRowActionGate(
  gate: SubscriptionGate,
): SubscriptionGate | null {
  return gate.allowed || gate.isOffline || gate.isPending ? gate : null;
}
