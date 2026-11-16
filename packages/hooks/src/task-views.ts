import {
  dayDelta,
  isDueOverdue,
  parseInstantOrBareLocalNoon,
} from "@repo/formatting";
import type { TaskStatus } from "./use-tasks";

/**
 * Where a task's due date falls from today (#4295 step 5, "Views"): the
 * rule web's My tasks groups by and its Due filter reads, written to be
 * shared so the phone's board can group by it too.
 *
 * - `overdue`: the server derived `OVERDUE` (its own clock decides, as the
 *   board's lanes always have), or an open task past due by `isDueOverdue`,
 *   the rule its due line turns red by: a timed task from that minute, a
 *   day-only task once its day has passed.
 * - `today`: due today.
 * - `week`: due in the six days after today. A rolling seven days, not the
 *   calendar week, so a Saturday's "This week" isn't one day long; Activity's
 *   To do gives the same seven days a heading each (`activity-agenda.ts`).
 * - `later`: further out, or a date this can't read (a task the member owes
 *   is kept and listed last rather than dropped).
 * - `earlier`: a finished task whose day has passed. It isn't overdue, and
 *   no filter but "Any time" asks for it.
 *
 * A task due at a time (`due_at`) is placed by that moment's local day.
 */
export type TaskDueBucket = "overdue" | "today" | "week" | "later" | "earlier";

/**
 * Days from today that still count as This week: today plus the next six.
 * The same seven days as Activity's `AGENDA_DAY_HORIZON`.
 */
const THIS_WEEK_DAYS = 7;

export const TASK_DUE_BUCKET_LABELS: Record<TaskDueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  earlier: "Earlier",
};

/** The Due filter's choices, in order; `earlier` is never one. */
export const TASK_DUE_FILTERS: readonly Exclude<TaskDueBucket, "earlier">[] = [
  "overdue",
  "today",
  "week",
  "later",
];

export function taskDueBucket(
  task: {
    due_date: string | null | undefined;
    due_at?: string | null;
    status: TaskStatus | null | undefined;
  },
  now: Date = new Date(),
): TaskDueBucket {
  if (task.status === "OVERDUE") return "overdue";
  // An unreadable time falls back to the day rather than hiding it.
  const timed = task.due_at ? parseInstantOrBareLocalNoon(task.due_at) : null;
  const raw = timed ? task.due_at : task.due_date;
  const due = timed ?? (raw ? parseInstantOrBareLocalNoon(raw) : null);
  if (!due) return "later";
  const done = task.status === "COMPLETED";
  if (!done && isDueOverdue(raw, now)) return "overdue";
  const days = dayDelta(now, due);
  if (days < 0) return done ? "earlier" : "overdue";
  if (days === 0) return "today";
  return days < THIS_WEEK_DAYS ? "week" : "later";
}

/**
 * My tasks' three groups, in order (#4295: "My tasks grouped as Today, This
 * week and Later"). Overdue leads Today rather than taking a group of its
 * own, as Todoist's Today view lists it: it is the first thing to do today,
 * and its due line already says it is late, in the warning hue.
 */
export type MyTasksGroup = "today" | "week" | "later";

export const MY_TASKS_GROUPS: readonly MyTasksGroup[] = [
  "today",
  "week",
  "later",
];

export const MY_TASKS_GROUP_LABELS: Record<MyTasksGroup, string> = {
  today: "Today",
  week: "This week",
  later: "Later",
};

/** The quiet line under a My tasks group with nothing in it. */
export const MY_TASKS_GROUP_EMPTY: Record<MyTasksGroup, string> = {
  today: "Nothing due today",
  week: "Nothing else this week",
  later: "Nothing later",
};

export function myTasksGroup(
  task: Parameters<typeof taskDueBucket>[0],
  now: Date = new Date(),
): MyTasksGroup {
  const bucket = taskDueBucket(task, now);
  return bucket === "overdue" || bucket === "earlier" ? "today" : bucket;
}

/**
 * Order inside a group: overdue first, then by due day, then by time within
 * the day with a task that has no time last (it is due by the end of the
 * day), then by title so the order holds between renders.
 */
export function compareTasksByDue(
  a: { due_date: string; due_at?: string | null; title: string; status: TaskStatus },
  b: { due_date: string; due_at?: string | null; title: string; status: TaskStatus },
): number {
  const aLate = a.status === "OVERDUE" ? 0 : 1;
  const bLate = b.status === "OVERDUE" ? 0 : 1;
  if (aLate !== bLate) return aLate - bLate;
  const byDay = a.due_date.localeCompare(b.due_date);
  if (byDay !== 0) return byDay;
  const aMs = timeOf(a.due_at);
  const bMs = timeOf(b.due_at);
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** A due time in ms; none, or one that can't be read, sorts last. */
function timeOf(dueAt: string | null | undefined): number {
  const ms = dueAt ? Date.parse(dueAt) : Number.NaN;
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}
