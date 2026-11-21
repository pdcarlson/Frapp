import { useMemo } from "react";
import { useCalendarBirthdays, useCalendarTasks } from "@repo/hooks";
import {
  ALL_CALENDAR_LAYERS,
  calendarTasksByDay,
  type CalendarItem,
} from "@repo/hooks/calendar-tasks";

/**
 * Everything on the phone's Calendar that isn't an event, by local day: the
 * member's own tasks on their due day and the ones they assigned (#4144), and
 * members' shared birthdays all day (#4959). Every kind, always: the chips
 * that switched each kind off went in #5310 (Paul: no switchers), so the
 * month and the Day screen read one set.
 *
 * `anchor` is any day in what is on screen; birthdays are read for its year
 * and the next (`useCalendarBirthdays`).
 */
export function useCalendarItemsByDay(
  anchor: Date,
): Map<string, CalendarItem[]> {
  const calendarTasks = useCalendarTasks();
  const birthdays = useCalendarBirthdays(anchor);
  return useMemo(
    () =>
      calendarTasksByDay(
        [...calendarTasks.items, ...birthdays],
        ALL_CALENDAR_LAYERS,
      ),
    [calendarTasks.items, birthdays],
  );
}
