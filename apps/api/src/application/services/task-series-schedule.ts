/**
 * The arithmetic of a repeating task's series (#5119), kept apart from the
 * services so it is tested on its own: when a copy is due, which day comes
 * next, and what the sweep writes when the latest copy's due passes. The
 * rule format and its stepping are `@repo/validation`'s (`recurrence.ts`),
 * shared with both apps' Repeat controls.
 */
import {
  nextTaskRepeatDate,
  parseTaskRepeatRule,
  taskCopyDueInstant,
  zonedDateAndTime,
  type TaskRepeatRule,
} from '@repo/validation';
import type { TaskSeries } from '#domain/entities/task.entity';

/**
 * How many days the sweep steps past at most to find a copy still to come.
 * A daily rule skipped over a long outage stops here and catches up on the
 * next run rather than looping without bound.
 */
const MAX_SKIPPED_DAYS = 400;

/** The rule, or `null` when it is not a task rule the API can step. */
export function readTaskRule(rule: unknown): TaskRepeatRule | null {
  return parseTaskRepeatRule(rule);
}

/**
 * A copy's time of day kept on the series: the wall-clock time of `dueAt` in
 * the rule's zone (`HH:MM:SS`), or null for a copy due by the end of its day.
 */
export function seriesDueTime(
  dueAt: string | null,
  rule: TaskRepeatRule,
): string | null {
  if (!dueAt) return null;
  return zonedDateAndTime(dueAt, rule.timeZone).time;
}

/**
 * When the copy on `date` is due: its own moment for a timed copy, else the
 * end of that day in the rule's zone, which is when the sweep makes the next.
 */
export function copyDueInstant(
  date: string,
  dueTime: string | null,
  rule: TaskRepeatRule,
): Date {
  return taskCopyDueInstant(date, dueTime, rule.timeZone);
}

/** What a new series stores besides its template (#5119). */
export interface SeriesStart {
  due_time: string | null;
  latest_due_at: string;
  next_due_date: string;
}

/**
 * The schedule fields of a series whose first copy is due on `dueDate`
 * (and at `dueAt`, when timed). `null` when the rule leaves no copy after
 * the first (an `UNTIL` on or before it), which the API refuses.
 */
export function planSeriesStart(
  rule: TaskRepeatRule,
  dueDate: string,
  dueAt: string | null,
): SeriesStart | null {
  const next = nextTaskRepeatDate(rule, dueDate, dueDate);
  if (!next) return null;
  const dueTime = seriesDueTime(dueAt, rule);
  const latest = dueAt ? new Date(dueAt) : copyDueInstant(dueDate, null, rule);
  return {
    due_time: dueTime,
    latest_due_at: latest.toISOString(),
    next_due_date: next,
  };
}

/** What the sweep writes for one due series. */
export interface NextCopyPlan {
  occurrenceDate: string;
  /** Set for a timed copy. */
  dueAt: string | null;
  latestDueAt: string;
  /** The day after this copy; null when the rule ends with it. */
  nextDueDate: string | null;
}

/**
 * The copy the sweep makes for a series whose latest copy is due: the first
 * day from `next_due_date` on whose copy is not already past due at `now`
 * (days a stopped sweep missed are skipped, not made overdue in a burst).
 * `null` when the rule runs out before one, so the series just ends.
 */
export function planNextCopy(
  series: Pick<
    TaskSeries,
    'recurrence_rule' | 'first_due_date' | 'next_due_date' | 'due_time'
  >,
  now: Date,
): NextCopyPlan | null {
  const rule = readTaskRule(series.recurrence_rule);
  if (!rule) return null;
  let day: string | null = series.next_due_date.slice(0, 10);
  const first = series.first_due_date.slice(0, 10);
  const limit = shiftDay(day, MAX_SKIPPED_DAYS);
  while (
    day &&
    day < limit &&
    copyDueInstant(day, series.due_time, rule).getTime() <= now.getTime()
  ) {
    day = nextTaskRepeatDate(rule, first, day);
  }
  if (!day) return null;
  const due = copyDueInstant(day, series.due_time, rule);
  return {
    occurrenceDate: day,
    dueAt: series.due_time ? due.toISOString() : null,
    latestDueAt: due.toISOString(),
    nextDueDate: nextTaskRepeatDate(rule, first, day),
  };
}

function shiftDay(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
