import { dueEntryFields } from "./date-entry";
import { localIsoDate } from "./local-date";

/**
 * A task's optional time of day (#4003), shared by the phone's New task sheet
 * and the web task forms (#4512) so both offer, word and refuse a time the
 * same way.
 */

/** A task's due as a form holds it: the day, and a time when it has one. */
export interface DueDayAndTime {
  /** `YYYY-MM-DD`, device-local. */
  dueDate: string;
  /** `HH:MM` on the 24-hour clock, device-local, or `null`/absent for none. */
  dueTime?: string | null;
}

/**
 * A time as a field shows it: `"5 PM"`, `"9:30 AM"`. The minutes only when
 * there are some, as a calendar writes a time.
 */
export function formatDueTimeLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const period = hours < 12 ? "AM" : "PM";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${hour} ${period}`
    : `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Where "Add a time" starts: 5 PM, the end of a chapter's working day, or
 * for a task due today once that has passed, the next whole hour (up to
 * 11 PM), so a fresh time is never already behind.
 */
export function suggestedDueTime(dueDate: string, now: Date): string {
  if (dueDate !== localIsoDate(now) || now.getHours() < 17) return "17:00";
  return `${String(Math.min(now.getHours() + 1, 23)).padStart(2, "0")}:00`;
}

/**
 * True when `due` names a time that has already gone by: a task created like
 * that would be overdue the moment it exists.
 */
export function dueTimePassed(
  due: DueDayAndTime,
  now: Date,
  /**
   * An edit's due as the task already has it (#4296). A task that is
   * overdue can still have its title or points changed, so its own due
   * isn't refused for having passed; only a newly picked one is.
   */
  kept?: DueDayAndTime,
): boolean {
  if (!due.dueTime) return false;
  if (
    kept &&
    kept.dueDate === due.dueDate &&
    (kept.dueTime ?? null) === due.dueTime
  ) {
    return false;
  }
  const { due_at } = dueEntryFields(`${due.dueDate}T${due.dueTime}`);
  return due_at !== undefined && Date.parse(due_at) <= now.getTime();
}

/**
 * A due entry (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, what `dueEntryFields`
 * reads) as its day and time.
 */
export function splitDueEntry(entry: string): DueDayAndTime {
  const [dueDate = "", time] = entry.split("T");
  return { dueDate, dueTime: time && /^\d{2}:\d{2}$/.test(time) ? time : null };
}
