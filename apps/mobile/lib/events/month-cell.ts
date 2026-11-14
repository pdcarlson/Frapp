import type { CalendarItem } from "@repo/hooks/calendar-tasks";
import type { EventAttendanceFields } from "@repo/validation";
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

/** How many titled lines a cell holds above the line under them. */
const TITLED_LINES = 2;

export type MonthCellLine =
  | { kind: "event"; key: string; title: string; required: boolean }
  | { kind: "birthday"; key: string; title: string };

export interface MonthCellSummary {
  /**
   * The titled lines drawn: two, or three when no task needs the line under
   * them and exactly one more would otherwise fold into "+1". A day with a
   * birthday keeps one of them for it, so a busy day never hides the only
   * sign of a birthday in a bare "+N".
   */
  lines: MonthCellLine[];
  /** Events and birthdays that had no room, drawn as "+N". */
  hidden: number;
  /** Every event's title, in start order, for the day's spoken label. */
  eventTitles: string[];
  /** Every birthday's name, for the day's spoken label. */
  birthdayNames: string[];
  taskCount: number;
  /** Whether any of the day's tasks is overdue. */
  overdue: boolean;
}

/**
 * `events` come in start order: the calendar files `selectAllEventRows`'s
 * rows, which are sorted, by day without reordering them.
 */
export function monthCellSummary(
  events: readonly EventRow[],
  items: readonly CalendarItem[],
  requiredOf: (event: EventAttendanceFields) => boolean,
): MonthCellSummary {
  const birthdays = items.filter((item) => item.kind === "birthdays");
  const tasks = items.filter((item) => item.kind !== "birthdays");
  const eventLines = events.map((event): MonthCellLine => ({
    kind: "event",
    key: event.id,
    title: event.name,
    required: requiredOf(event.attendance),
  }));
  const birthdayLines = birthdays.map((item): MonthCellLine => ({
    kind: "birthday",
    key: item.key,
    title: item.title,
  }));
  const total = eventLines.length + birthdayLines.length;
  // The line under the titles holds "+N" and the task count. With no tasks
  // and exactly one title over, that line shows the title instead of "+1".
  const room =
    tasks.length === 0 && total === TITLED_LINES + 1
      ? TITLED_LINES + 1
      : TITLED_LINES;
  const eventRoom =
    total <= room
      ? eventLines.length
      : Math.min(eventLines.length, room - (birthdayLines.length > 0 ? 1 : 0));
  const lines = [
    ...eventLines.slice(0, eventRoom),
    ...birthdayLines.slice(0, room - eventRoom),
  ];
  return {
    lines,
    hidden: total - lines.length,
    eventTitles: events.map((event) => event.name),
    birthdayNames: birthdays.map((item) => item.title),
    taskCount: tasks.length,
    overdue: tasks.some((item) => item.state === "overdue"),
  };
}
