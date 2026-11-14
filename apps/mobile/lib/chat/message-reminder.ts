import { useCallback } from "react";
import { AccessibilityInfo, Alert } from "react-native";
import { useSetMessageReminder } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { formatActedLabel, formatTimeOfDay } from "@repo/formatting";
import { selectionHaptic } from "@/lib/haptics";

/** The alert title when a reminder can't be set or moved. */
export const REMINDER_FAILED_TITLE = "Couldn't set the reminder";

/**
 * When a reminder is for, in a sentence: "today at 3:40 PM", "tomorrow at
 * 9:00 AM", "Monday at 9:00 AM", "Nov 30 at 9:00 AM". The same words web's
 * toast says (`formatActedLabel`, which both read), so the clients agree.
 */
export function reminderAtLabel(at: Date, now: Date = new Date()): string {
  // `formatActedLabel` reads an ISO string, not a `Date`.
  const said = formatActedLabel("", at.toISOString(), now);
  return said ? said.trim() : formatTimeOfDay(at.toISOString());
}

/**
 * A preset's time on the right of its row, as Slack's menu shows it: the
 * clock for today, the short weekday and clock for any later day.
 */
export function reminderPresetValue(at: Date, now: Date): string {
  const time = formatTimeOfDay(at.toISOString());
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return time;
  return `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** What the member hears once a reminder is set: "Reminder set for …". */
export function reminderSetAnnouncement(
  at: Date,
  now: Date = new Date(),
): string {
  return `Reminder set for ${reminderAtLabel(at, now)}`;
}

/**
 * "Remind me about this" (#4957) for both long-press sheets, the channel's
 * (`app/(app)/chat-thread.tsx`) and a message thread's
 * (`message-thread-screen.tsx`), as `useSaveMessage` serves Save to both.
 *
 * A set confirms as Save and Forward do on the phone, which has no toast: a
 * tick of haptics on the press, and the time said to a screen reader once
 * the server has it. The reminder then
 * shows under Reminders on Activity. A failed write says so in an alert.
 */
export function useRemindMessage() {
  const setReminder = useSetMessageReminder();
  return useCallback(
    (messageId: string, remindAt: Date) => {
      selectionHaptic();
      setReminder
        .mutateAsync({ messageId, remindAt })
        .then(() => {
          AccessibilityInfo.announceForAccessibility(
            reminderSetAnnouncement(remindAt),
          );
        })
        .catch((error: unknown) => {
          Alert.alert(REMINDER_FAILED_TITLE, errorCopy(error));
        });
    },
    [setReminder],
  );
}
