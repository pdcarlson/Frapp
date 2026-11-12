import { dueEntryFields, formatDueTimeLabel, TIME_OF_DAY } from "./date-entry";
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

export { formatDueTimeLabel };

/**
 * Where "Add a time" starts: 5 PM, the end of a chapter's working day, or
 * for a task due today once that has passed, the next whole hour, and from
 * 11 PM on, 11:59 PM, so a fresh time is behind only in the day's last
 * minute.
 */
export function suggestedDueTime(dueDate: string, now: Date): string {
  if (dueDate !== localIsoDate(now) || now.getHours() < 17) return "17:00";
  if (now.getHours() >= 23) return "23:59";
  return `${String(now.getHours() + 1).padStart(2, "0")}:00`;
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
  return { dueDate, dueTime: time && TIME_OF_DAY.test(time) ? time : null };
}
