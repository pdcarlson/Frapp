import { Alert } from "react-native";
import {
  activityRowSnoozable,
  activitySnoozeOptions,
  useActivitySnooze,
  type ActivityRow,
  type ActivitySnoozeOption,
} from "@repo/hooks";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import {
  openItemMenu,
  type ItemMenuAction,
} from "@/components/item-actions-menu";
import { NavGlyph } from "@/components/nav-glyph";
import { alertFailure } from "@/lib/failure-alert";

/** The glyph Snooze and Unsnooze draw in a row's menu: the clock reminders use. */
const snoozeGlyph = (color: string) => (
  <NavGlyph paths={NAV_GLYPHS.schedule} color={color} size={20} />
);

/**
 * Snooze on the phone's Activity (#4982, `spec/behavior/activity.md` §
 * Snooze): on a row that waits on the member, Snooze offers Gmail's fixed
 * times in the glass menu (`openItemMenu`), as a long press on a message in Gmail's
 * app offers Snooze. The row leaves the list at once; a snoozed row's
 * Unsnooze, under Snoozed, brings it back. A write that fails puts the row
 * back and says so.
 *
 * Each is a row of the row's long-press menu (`useActivityRowMenu`), beside a
 * task's or an event's own actions (#5492), and a screen reader's named
 * action; a row with nothing else to offer runs it on the long press itself.
 */
export function useActivitySnoozeMenu(): {
  snoozeActionFor: (row: ActivityRow) => ItemMenuAction | null;
  wakeActionFor: (row: ActivityRow) => ItemMenuAction;
} {
  const { snooze, unsnooze } = useActivitySnooze();

  const pick = (row: ActivityRow, option: ActivitySnoozeOption) => {
    // A reminder (#4957) names no item to snooze; it has its own Snooze.
    const ref = row.readRef;
    if (!ref) return;
    const send = () => {
      snooze(ref, option.until).catch((error: unknown) =>
        alertFailure({ title: "Couldn't snooze it", error, retry: send }),
      );
    };
    send();
  };

  const wake = (row: ActivityRow) => {
    const ref = row.readRef;
    if (!ref) return;
    const send = () => {
      unsnooze(ref).catch((error: unknown) =>
        alertFailure({ title: "Couldn't unsnooze it", error, retry: send }),
      );
    };
    send();
  };

  const openSnooze = (row: ActivityRow) => {
    // Read when the sheet opens, so "Later today" is never in the past.
    const options = activitySnoozeOptions(new Date());
    openItemMenu({
      title: "Snooze until",
      message: row.title,
      actions: options.map((option, index) => ({
        key: `snooze-${index}`,
        label: option.menuLabel,
        run: () => pick(row, option),
      })),
    });
  };

  return {
    snoozeActionFor: (row) =>
      activityRowSnoozable(row)
        ? {
            key: "snooze",
            label: "Snooze",
            glyph: snoozeGlyph,
            run: () => openSnooze(row),
          }
        : null,
    wakeActionFor: (row) => ({
      key: "unsnooze",
      label: "Unsnooze",
      glyph: snoozeGlyph,
      // Asked, not done on the press: a long press that acted at once
      // would be easy to make by accident while scrolling.
      run: () =>
        Alert.alert(row.title, "Bring it back to your list now?", [
          { text: "Cancel", style: "cancel" },
          { text: "Unsnooze", onPress: () => wake(row) },
        ]),
    }),
  };
}
