import { useRef, useState } from "react";
import { AccessibilityInfo, Alert } from "react-native";
import {
  activityRowAction,
  TASK_ACTION_LABELS,
  useConfirmTask,
  useReviewServiceEntry,
  type ActivityRow,
  type ActivityRowAction,
} from "@repo/hooks";
import { useConnection } from "@/lib/connection/use-connection";
import {
  hoursReviewFailure,
  taskConfirmFailure,
} from "@/lib/activity/row-action";
import { ActivityListRow, type ActivityRowActionControl } from "./activity-row";

const LABELS: Record<ActivityRowAction, string> = {
  confirm: TASK_ACTION_LABELS.confirm,
  approve: "Approve",
};

/** Said to a screen reader once the write lands, since the row then leaves. */
const DONE: Record<ActivityRowAction, string> = {
  confirm: "Confirmed",
  approve: "Approved",
};

/** What the screen hands its rows' actions, or `null` while the plan refuses them. */
export interface ActivityRowActions {
  /** The chapter record hasn't resolved: the buttons show, disabled. */
  chapterPending: boolean;
  /** Records the read and re-reads, so the row leaves Needs you. */
  onActed: (row: ActivityRow) => void;
}

/**
 * An Activity row, with its ask as a button when it is one press with
 * nothing to choose (`activityRowAction`: Confirm, Approve; #4437), as web's
 * rows carry them (#4428). Any other row, or every row while the plan
 * refuses those writes (`actions` is `null`), is the plain row.
 */
export function ActivityRowItem({
  row,
  isFirst,
  actions,
  onPress,
}: {
  row: ActivityRow;
  isFirst: boolean;
  actions: ActivityRowActions | null;
  onPress: () => void;
}) {
  const action = actions ? activityRowAction(row) : null;
  if (!action || !actions) {
    return <ActivityListRow row={row} isFirst={isFirst} onPress={onPress} />;
  }
  return (
    <ActionRow
      row={row}
      isFirst={isFirst}
      action={action}
      actions={actions}
      onPress={onPress}
    />
  );
}

function ActionRow({
  row,
  isFirst,
  action,
  actions,
  onPress,
}: {
  row: ActivityRow;
  isFirst: boolean;
  action: ActivityRowAction;
  actions: ActivityRowActions;
  onPress: () => void;
}) {
  const control = useActivityRowAction(row, action, actions);
  return (
    <ActivityListRow
      row={row}
      isFirst={isFirst}
      action={control}
      onPress={onPress}
    />
  );
}

/**
 * A row's one-press ask (#4437): Confirm a completed task or Approve service
 * hours from the row, through what the sheet calls, in the sheet's words:
 * the task card's `useConfirmTask` and failure line, the hours sheet's
 * `useReviewServiceEntry` and `hoursReviewFailure`. Reject, a send-back and
 * the record itself stay in the sheet.
 *
 * Once the write lands the button stays disabled until the re-read takes
 * the row away: a second press would be refused as a repeat. It is also
 * disabled while a write would be lost (`writeBlockedReason`, its hint), as
 * the sheet's buttons are, and while the chapter record loads. A refusal is
 * the platform's alert, naming the item, since the row has no line to carry
 * it and the phone has no toast.
 */
export function useActivityRowAction(
  row: ActivityRow,
  action: ActivityRowAction,
  actions: ActivityRowActions,
): ActivityRowActionControl {
  const confirmTask = useConfirmTask();
  const reviewEntry = useReviewServiceEntry();
  const { writeBlockedReason } = useConnection();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  // State reaches React a tick after the press, so two taps in one frame
  // would both send; the ref is set before the first await.
  const inFlight = useRef(false);

  async function write(): Promise<string | null> {
    try {
      if (action === "confirm" && row.kind === "task") {
        await confirmTask.mutateAsync(row.task.id);
        return null;
      }
      if (action === "approve" && row.kind === "hours") {
        await reviewEntry.mutateAsync({
          id: row.entry.id,
          body: { status: "APPROVED" },
        });
        return null;
      }
      return "";
    } catch (error) {
      return action === "confirm"
        ? taskConfirmFailure(error)
        : hoursReviewFailure(error, "APPROVED");
    }
  }

  const run = async () => {
    if (inFlight.current || state !== "idle") return;
    inFlight.current = true;
    setState("busy");
    const failure = await write();
    inFlight.current = false;
    if (failure !== null) {
      setState("idle");
      if (failure) Alert.alert(row.title, failure);
      return;
    }
    setState("done");
    AccessibilityInfo.announceForAccessibility(`${DONE[action]}: ${row.title}`);
    actions.onActed(row);
  };

  return {
    label: LABELS[action],
    disabled:
      state !== "idle" || writeBlockedReason !== null || actions.chapterPending,
    hint: writeBlockedReason ?? undefined,
    run: () => void run(),
  };
}
