import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  activityRowAction,
  TASK_ACTION_LABELS,
  useConfirmTask,
  useReviewServiceEntry,
  type ActivityRow,
  type ActivityRowAction,
} from "@repo/hooks";
import { useConnection } from "@/lib/connection/use-connection";
import { alertFailure } from "@/lib/failure-alert";
import {
  rowActionFailure,
  type ActivityRowActionState,
} from "@/lib/activity/row-action";
import { ActivityListRow, type ActivityRowActionControl } from "./activity-row";

const LABELS: Record<ActivityRowAction, string> = {
  confirm: TASK_ACTION_LABELS.confirm,
  approve: "Approve",
};

/** What the button says once its write has landed, and a screen reader hears. */
const DONE: Record<ActivityRowAction, string> = {
  confirm: TASK_ACTION_LABELS.confirmed,
  approve: "Approved",
};

/** What the screen hands its rows, or `null` while those writes are refused. */
export interface ActivityRowActions {
  stateOf: (key: string) => ActivityRowActionState;
  /** Why the buttons are held (the connection, or the chapter loading), else `null`. */
  heldReason: string | null;
  /** Held without a reason to give: the chapter record is still loading. */
  held: boolean;
  run: (row: ActivityRow, action: ActivityRowAction) => void;
}

/**
 * The rows' one-press asks (#4437): Confirm a completed task or Approve
 * service hours from the row, through what the sheet calls, in the sheet's
 * words: `useConfirmTask` with the task card's failure line, and
 * `useReviewServiceEntry` with the hours sheet's (`rowActionFailure`). Web's
 * twin is `apps/web/components/activity/activity-row-action.tsx`.
 *
 * Held by the screen, not by each row, so where an item's write stands
 * outlives the row drawing it. A row drawn again (Show all, a chip) still
 * knows its write is sending or has landed, and the sheet opened from the
 * same row (`stateOf`) doesn't offer Approve a second time. Once a write
 * lands its button stays disabled, reading "Confirmed" or "Approved", until
 * the re-read takes the row away: a second press would be refused as a
 * repeat. A ref, set before the first await, stops two taps in one frame
 * from both sending.
 *
 * `null` while the chapter's plan refuses those writes (`allowed`), so every
 * row opens its sheet, and also after a refusal from the plan or the module
 * gate (`useCardWrite`'s rule): pressing again would only fetch the same
 * refusal. That lasts until the member comes back to this screen or to the
 * app, since an officer may have sorted it out by then. The buttons are
 * disabled while a write would be lost (`writeBlockedReason`, their hint,
 * as the sheet's buttons are) and while the chapter record loads. Any other
 * refusal is the platform's alert, naming the item, since the row has no
 * line to carry it, and leaves the button for a retry.
 */
export function useActivityRowActions({
  allowed,
  chapterPending,
  onActed,
}: {
  /** The plan's own verdict (`activityRowActionsAllowed`). */
  allowed: boolean;
  chapterPending: boolean;
  /** Records the read and re-reads, so the row leaves Needs you. */
  onActed: (row: ActivityRow) => void;
}): {
  /** `null` while the writes are refused: every row opens its sheet. */
  actions: ActivityRowActions | null;
  /** Where each row's write stands, refused or not, for the sheet. */
  stateOf: (key: string) => ActivityRowActionState;
} {
  const confirmTask = useConfirmTask();
  const reviewEntry = useReviewServiceEntry();
  const { writeBlockedReason } = useConnection();
  const [states, setStates] = useState<
    ReadonlyMap<string, ActivityRowActionState>
  >(() => new Map());
  const inFlight = useRef(new Set<string>());
  const [refused, setRefused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setRefused(false);
      return undefined;
    }, []),
  );
  useEffect(() => {
    if (!refused) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setRefused(false);
    });
    return () => subscription.remove();
  }, [refused]);

  const setState = (key: string, state: ActivityRowActionState) =>
    setStates((current) => new Map(current).set(key, state));

  const write = (row: ActivityRow, action: ActivityRowAction) => {
    if (action === "confirm" && row.kind === "task") {
      return confirmTask.mutateAsync(row.task.id);
    }
    if (action === "approve" && row.kind === "hours") {
      return reviewEntry.mutateAsync({
        id: row.entry.id,
        body: { status: "APPROVED" },
      });
    }
    return null;
  };

  const run = async (row: ActivityRow, action: ActivityRowAction) => {
    const key = row.key;
    if (inFlight.current.has(key) || (states.get(key) ?? "idle") !== "idle") {
      return;
    }
    const sending = write(row, action);
    if (!sending) return;
    inFlight.current.add(key);
    setState(key, "busy");
    try {
      await sending;
    } catch (error) {
      inFlight.current.delete(key);
      setState(key, "idle");
      const failure = rowActionFailure(action, error);
      if (failure.gate) setRefused(true);
      alertFailure({
        title: row.title,
        error,
        message: failure.text,
        retry: () => {
          void run(row, action);
        },
      });
      return;
    }
    inFlight.current.delete(key);
    setState(key, "done");
    AccessibilityInfo.announceForAccessibility(`${DONE[action]}: ${row.title}`);
    onActed(row);
  };

  const stateOf = (key: string) => states.get(key) ?? "idle";
  if (!allowed || refused) return { actions: null, stateOf };
  return {
    actions: {
      stateOf,
      heldReason: writeBlockedReason,
      held: writeBlockedReason !== null || chapterPending,
      run: (row, action) => void run(row, action),
    },
    stateOf,
  };
}

/**
 * An Activity row, with its ask as a button when it is one press with
 * nothing to choose (`activityRowAction`: Confirm, Approve; #4437), as web's
 * rows carry them (#4428). Any other row, or every row while those writes
 * are refused (`actions` is `null`), is the plain row.
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
  const control: ActivityRowActionControl | null =
    action && actions ? rowActionControl(row, action, actions) : null;
  return (
    <ActivityListRow
      row={row}
      isFirst={isFirst}
      action={control}
      onPress={onPress}
    />
  );
}

function rowActionControl(
  row: ActivityRow,
  action: ActivityRowAction,
  actions: ActivityRowActions,
): ActivityRowActionControl {
  const state = actions.stateOf(row.key);
  return {
    label: state === "done" ? DONE[action] : LABELS[action],
    disabled: state !== "idle" || actions.held,
    hint: state === "idle" ? (actions.heldReason ?? undefined) : undefined,
    run: () => actions.run(row, action),
  };
}
