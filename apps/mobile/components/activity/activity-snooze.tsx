import { ActionSheetIOS, Alert, Platform } from "react-native";
import {
  activityRowSnoozable,
  activitySnoozeOptions,
  useActivitySnooze,
  type ActivityRow,
  type ActivitySnoozeOption,
} from "@repo/hooks";
import { alertFailure } from "@/lib/failure-alert";
import type { ActivityRowMenu } from "./activity-row";

/**
 * Android's dialog draws at most three buttons and drops the rest, so the
 * phone offers the first three of the times there; back or a tap outside
 * closes it. iOS's action sheet lists every time and Cancel.
 */
const ANDROID_BUTTONS = 3;

/**
 * Snooze on the phone's Activity (#4982, `spec/behavior/activity.md` §
 * Snooze): a long press on a row that waits on the member (or VoiceOver's
 * and TalkBack's "Snooze" action) offers Gmail's fixed times in the
 * platform's own sheet, as a long press on a message in Gmail's app offers
 * Snooze. The row leaves the list at once; a snoozed row's long press, under
 * Snoozed, brings it back. A write that fails puts the row back and says so.
 */
export function useActivitySnoozeMenu(): {
  menuFor: (row: ActivityRow) => ActivityRowMenu | null;
  wakeMenuFor: (row: ActivityRow) => ActivityRowMenu;
} {
  const { snooze, unsnooze } = useActivitySnooze();

  const pick = (row: ActivityRow, option: ActivitySnoozeOption) => {
    const send = () => {
      snooze(row.readRef, option.until).catch((error: unknown) =>
        alertFailure({ title: "Couldn't snooze it", error, retry: send }),
      );
    };
    send();
  };

  const wake = (row: ActivityRow) => {
    const send = () => {
      unsnooze(row.readRef).catch((error: unknown) =>
        alertFailure({ title: "Couldn't unsnooze it", error, retry: send }),
      );
    };
    send();
  };

  const openSnooze = (row: ActivityRow) => {
    // Read when the sheet opens, so "Later today" is never in the past.
    const options = activitySnoozeOptions(new Date());
    const labels = options.map((option) => option.menuLabel);
    if (Platform.OS === "ios") {
      const buttons = [...labels, "Cancel"];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Snooze “${row.title}” until`,
          options: buttons,
          cancelButtonIndex: buttons.length - 1,
        },
        (index) => {
          const option = options[index];
          if (option) pick(row, option);
        },
      );
      return;
    }
    Alert.alert(
      "Snooze until",
      row.title,
      options.slice(0, ANDROID_BUTTONS).map((option, index) => ({
        text: labels[index],
        onPress: () => pick(row, option),
      })),
      { cancelable: true },
    );
  };

  return {
    menuFor: (row) =>
      activityRowSnoozable(row)
        ? { label: "Snooze", open: () => openSnooze(row) }
        : null,
    wakeMenuFor: (row) => ({
      label: "Unsnooze",
      // Asked, not done on the press: a long press that acted at once
      // would be easy to make by accident while scrolling.
      open: () =>
        Alert.alert(row.title, "Bring it back to your list now?", [
          { text: "Cancel", style: "cancel" },
          { text: "Unsnooze", onPress: () => wake(row) },
        ]),
    }),
  };
}
