import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { statusOf } from "@repo/api-sdk";
import {
  activityRowAction,
  TASK_ACTION_LABELS,
  useCheckIn,
  useConfirmTask,
  useReviewServiceEntry,
  type ActivityRow,
  type ActivityRowAction,
} from "@repo/hooks";
import { useConnection } from "@/lib/connection/use-connection";
import { alertFailure } from "@/lib/failure-alert";
import {
  CHECK_IN_LOCATION_DENIED_COPY,
  needsLocationRefusal,
  needsScannedCode,
} from "@/lib/events/check-in-outcome";
import { latLngOf, requireForegroundFix } from "@/lib/location";
import {
  rowActionFailure,
  type ActivityRowActionState,
} from "@/lib/activity/row-action";
import { ActivityListRow, type ActivityRowActionControl } from "./activity-row";

const LABELS: Record<ActivityRowAction, string> = {
  confirm: TASK_ACTION_LABELS.confirm,
  approve: "Approve",
  "check-in": "Check in",
};

/** What the button says once its write has landed, and a screen reader hears. */
const DONE: Record<ActivityRowAction, string> = {
  confirm: TASK_ACTION_LABELS.confirmed,
  approve: "Approved",
  "check-in": "Checked in",
};

/**
 * A row check-in answered 409: the member already has an attendance row,
 * a check-in or an officer's mark, so it says no more than that (web's
 * `useSelfCheckIn` says the same, "Already on the list").
 */
export const ALREADY_ON_LIST_COPY =
  "You're already on the attendance list for this event.";

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
 * The rows' one-press asks (#4437): Confirm a completed task, Approve
 * service hours or Check in to an event from the row, through what the sheet
 * calls, in the sheet's words: `useConfirmTask` with the task card's failure
 * line, `useReviewServiceEntry` with the hours sheet's, and `useCheckIn` with
 * the chat event card's (`rowActionFailure`). Web's twin is
 * `apps/web/components/activity/activity-row-action.tsx`.
 *
 * Check in is on the row of any event the member can check in to now, a
 * zoned one included (#4427): the phone can supply the location web can't,
 * so the press asks for it, as the chat event card does, only when the read
 * says the event has a zone. Otherwise it sends the plain check-in, and if
 * the server answers that the event needs a location (a zone drawn since the
 * read, or a read from before the field) it asks then and sends once more.
 * A 409 is a row the member already has, which may be an officer's mark, so
 * the alert says only that and the screen re-reads. Once an officer's screen
 * has shown the code the server wants it (#4532), and the alert offers s18
 * to point the camera at it or type it.
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
  /** Records the read and re-reads, so the row leaves its list. */
  onActed: (row: ActivityRow) => void;
}): {
  /** `null` while the writes are refused: every row opens its sheet. */
  actions: ActivityRowActions | null;
  /** Where each row's write stands, refused or not, for the sheet. */
  stateOf: (key: string) => ActivityRowActionState;
} {
  const confirmTask = useConfirmTask();
  const reviewEntry = useReviewServiceEntry();
  const checkIn = useCheckIn();
  const router = useRouter();
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
    if (action === "check-in" && row.kind === "event") {
      return checkInFromRow(row.event);
    }
    return null;
  };

  const checkInFromRow = async (
    event: Extract<ActivityRow, { kind: "event" }>["event"],
  ) => {
    // Coordinates only, as the card sends them: an API from before #4532
    // refuses an `accuracy_meters` it doesn't declare.
    const send = async (withLocation: boolean) => {
      const position = withLocation
        ? latLngOf(await requireForegroundFix(CHECK_IN_LOCATION_DENIED_COPY))
        : {};
      await checkIn.mutateAsync({ eventId: event.id, ...position });
    };
    const zoned = event.check_in_needs_location === true;
    try {
      await send(zoned);
    } catch (error) {
      // A zone drawn since the read, or a read from before the field: the
      // server says the event needs a location, which the phone can send,
      // so ask once now rather than show a refusal written for web.
      if (zoned || !needsLocationRefusal(error)) throw error;
      await send(true);
    }
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
      if (action === "check-in" && statusOf(error) === 409) {
        // A row already exists, which may be an officer's excused or
        // absent mark rather than a check-in, so say only that and re-read:
        // the row then shows which.
        Alert.alert(row.title, ALREADY_ON_LIST_COPY);
        onActed(row);
        return;
      }
      if (
        action === "check-in" &&
        row.kind === "event" &&
        needsScannedCode(error)
      ) {
        const eventId = row.event.id;
        Alert.alert(row.title, failure.text, [
          { text: "Not now", style: "cancel" },
          {
            text: "Enter code",
            onPress: () =>
              router.push({ pathname: "/check-in", params: { eventId } }),
          },
        ]);
        return;
      }
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
 * nothing to choose (`activityRowAction`: Confirm, Approve, Check in;
 * #4437, #4427), as web's
 * rows carry them (#4428). Any other row, or every row while those writes
 * are refused (`actions` is `null`), is the plain row.
 */
export function ActivityRowItem({
  row,
  isFirst,
  actions,
  onCard = false,
  solo = false,
  onPress,
}: {
  row: ActivityRow;
  isFirst: boolean;
  actions: ActivityRowActions | null;
  /** The row sits in a card (the To review card): `ActivityListRow`'s. */
  onCard?: boolean;
  /** The week card's Next row: `ActivityListRow`'s. */
  solo?: boolean;
  onPress: () => void;
}) {
  // The phone can supply a location, so a zoned event checks in here too.
  const action = actions
    ? activityRowAction(row, { canSupplyLocation: true, canScan: true })
    : null;
  const control: ActivityRowActionControl | null =
    action && actions ? rowActionControl(row, action, actions) : null;
  return (
    <ActivityListRow
      row={row}
      isFirst={isFirst}
      action={control}
      onCard={onCard}
      solo={solo}
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
