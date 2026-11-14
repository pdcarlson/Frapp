import type { CalendarItem } from "@repo/hooks/calendar-tasks";
import type { EventAttendanceFields } from "@repo/validation";
import { sortEventsByStart } from "./format";
import type { EventRow } from "./select";

/**
 * What one day of the phone's month grid writes in its cell (#4987): the
 * day's events by title, then its birthdays, as many as fit, and one line
 * under them for what didn't fit and for the tasks due.
 *
 * Titles in the cells, as Apple Calendar's detailed month and Google
 * Calendar's phone month draw them, so a member reads the month without
 * tapping each day. A cell is about a seventh of a phone's width, so a title
 * is cut to what fits; the selected day's list under the grid still has the
 * whole row.
 */

/** How many titled lines a cell holds before the rest fold into "+N". */
export const MONTH_CELL_LINES = 2;

export type MonthCellLine =
  | { kind: "event"; key: string; title: string; required: boolean }
  | { kind: "birthday"; key: string; title: string };

export interface MonthCellSummary {
  /** The titled lines drawn, at most {@link MONTH_CELL_LINES}. */
  lines: MonthCellLine[];
  /** Events and birthdays that had no room, drawn as "+N". */
  hidden: number;
  eventCount: number;
  birthdayCount: number;
  taskCount: number;
  /** Whether any of the day's tasks is overdue. */
  overdue: boolean;
}

export function monthCellSummary(
  events: EventRow[],
  items: readonly CalendarItem[],
  requiredOf: (event: EventAttendanceFields) => boolean,
  maxLines: number = MONTH_CELL_LINES,
): MonthCellSummary {
  const byStart = sortEventsByStart(events);
  const birthdays = items.filter((item) => item.kind === "birthdays");
  const tasks = items.filter((item) => item.kind !== "birthdays");
  const all: MonthCellLine[] = [
    ...byStart.map((event): MonthCellLine => ({
      kind: "event",
      key: event.id,
      title: event.name,
      required: requiredOf(event.attendance),
    })),
    ...birthdays.map((item): MonthCellLine => ({
      kind: "birthday",
      key: item.key,
      title: item.title,
    })),
  ];
  // The line under the titles holds "+N" and the task count. With no tasks
  // and exactly one title over, that line shows the title instead of "+1".
  const room =
    tasks.length === 0 && all.length === maxLines + 1 ? maxLines + 1 : maxLines;
  const lines = all.slice(0, room);
  return {
    lines,
    hidden: all.length - lines.length,
    eventCount: byStart.length,
    birthdayCount: birthdays.length,
    taskCount: tasks.length,
    overdue: tasks.some((item) => item.state === "overdue"),
  };
}
