import { TaskStatus, type TaskView } from '#domain/entities/task.entity';
import { localDateIn } from '#domain/utils/zoned-time';
import { longDateTime, longDay } from './chapter-tool-kit';

/** How a task's due day and state are read, by both task tools (#4901). */

/** The day a task is due, as the asker sees it. */
export function dueDay(task: TaskView, timeZone: string): string {
  // `due_at` is an instant and `due_date` a calendar day, so the two are
  // never compared as strings: 8 PM Saturday in New York is already Sunday
  // in UTC.
  return task.due_at
    ? localDateIn(new Date(task.due_at), timeZone)
    : task.due_date;
}

/**
 * By the day, then by the time on that day, with a task that has no time
 * after the timed ones (it is due by the end of the day).
 */
export function dueFirst(timeZone: string) {
  return (a: TaskView, b: TaskView) =>
    dueDay(a, timeZone).localeCompare(dueDay(b, timeZone)) ||
    (a.due_at && b.due_at
      ? Date.parse(a.due_at) - Date.parse(b.due_at)
      : a.due_at
        ? -1
        : b.due_at
          ? 1
          : 0);
}

export function whenDue(task: TaskView, timeZone: string): string {
  return task.due_at
    ? longDateTime(task.due_at, timeZone)
    : longDay(task.due_date, timeZone);
}

/** Marked done by its assignee and not yet confirmed by an officer. */
export function awaitsConfirm(task: TaskView): boolean {
  return task.stored_status === TaskStatus.COMPLETED && !task.confirmed_at;
}

export function isPastDue(task: TaskView): boolean {
  return task.status === TaskStatus.OVERDUE;
}

/** Latest finish first; a task with no finish time recorded goes last. */
export function latestFinishFirst(
  a: Pick<TaskView, 'confirmed_at'>,
  b: Pick<TaskView, 'confirmed_at'>,
): number {
  return (b.confirmed_at ?? '').localeCompare(a.confirmed_at ?? '');
}
