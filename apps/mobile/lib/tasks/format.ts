/**
 * Date and chip copy for the s08 task board.
 *
 * Pure and `now`-injected, so the screen stays presentational and the rollover
 * cases are testable without freezing a clock — the convention
 * `lib/events/format.ts` and `lib/more/service-hours.ts` already set.
 *
 * ## Why these are not `up-next-strip.tsx`'s formatters
 *
 * That strip answers "how soon" in a one-line pulse and renders lowercase
 * fragments (`"due tmrw"`, `"overdue"`) that read as a clause beside a title.
 * The board draws a standalone subtitle under each title, and
 * `canvas-screens.dc.html` s08 sets it in sentence case — `"Due tomorrow"`,
 * `"Due Aug 22"`. That is the same register split `lib/events/format.ts`
 * documents and refuses to merge; merging here would force one of the two
 * surfaces to render the wrong one.
 *
 * `isDueUrgent` is **not** duplicated — urgency is one rule, not two, so it is
 * imported from the strip unchanged and re-exported for the board's callers.
 */

import { parseInstantOrBareUtcNoon } from "@repo/formatting";

export { isDueUrgent } from "@/components/chat/up-next-strip";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole calendar days between two instants, ignoring time of day.
 *
 * `Date.UTC` of each *local* Y/M/D — the arithmetic is done in UTC only to
 * sidestep DST, while the calendar days themselves stay local. Identical to the
 * helper in `up-next-strip.tsx` and `lib/events/format.ts`.
 */
export function dayDelta(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * A bare `YYYY-MM-DD` parsed at UTC **noon**.
 *
 * Midnight would render as the previous day for anyone west of Greenwich, and a
 * task due the 22nd must not read "Due Aug 21". Same reasoning, same fix as
 * `formatDate` in `lib/more/service-hours.ts`.
 */
export function parseTaskDate(value: string): Date | null {
  // A full timestamp passes through untouched: appending `T12:00:00Z` to one
  // yields `NaN`, and the chat `kind:"task"` payload can carry either shape.
  // Protected cluster — UTC noon for bare dates, not formatLocaleDate's
  // `new Date(value)` (UTC midnight).
  return parseInstantOrBareUtcNoon(value);
}

/** Any parseable instant — `completed_at` is a full ISO timestamp, not a date. */
function parseInstant(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Days since a task was finished, or `null` when it carries no readable
 * `completed_at`. Positive means in the past.
 */
export function daysSinceCompletion(
  completedAt: string | null,
  now: Date,
): number | null {
  if (!completedAt) return null;
  const at = parseInstant(completedAt);
  return at ? dayDelta(at, now) : null;
}

/**
 * The subtitle under an open task's title.
 *
 * Returns `null` for a date this module cannot read, so the row draws a title
 * with no subtitle rather than "Invalid Date" — `narrow.ts` states the same
 * preference. The caller keeps the row: dropping a task the member owes is
 * worse than an odd-looking one.
 */
export function formatDueSubtitle(
  dueDate: string | null,
  now: Date,
): string | null {
  if (!dueDate) return null;
  const due = parseTaskDate(dueDate);
  if (!due) return null;

  const days = dayDelta(now, due);
  if (days < 0) {
    const overdueBy = -days;
    return `Overdue by ${overdueBy} ${overdueBy === 1 ? "day" : "days"}`;
  }
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 7) {
    return `Due ${due.toLocaleDateString(undefined, { weekday: "long" })}`;
  }
  return `Due ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * The subtitle under a completed task's title — drawn as "Done Tuesday".
 *
 * Falls back to a bare "Done" rather than `null`: the row is already dimmed and
 * struck through, and a completed row with no subtitle at all loses the one
 * word that explains why.
 */
export function formatDoneSubtitle(
  completedAt: string | null,
  now: Date,
): string {
  if (!completedAt) return "Done";
  const at = parseInstant(completedAt);
  if (!at) return "Done";

  const days = dayDelta(at, now);
  if (days <= 0) return "Done today";
  if (days === 1) return "Done yesterday";
  if (days < 7) {
    return `Done ${at.toLocaleDateString(undefined, { weekday: "long" })}`;
  }
  return `Done ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export type PointsChip =
  /** Gold chip — points on offer, or earned but not yet confirmed. */
  | { tone: "offered"; label: string }
  /** Green chip with a check — the ledger has actually moved. */
  | { tone: "awarded"; label: string };

/**
 * The trailing chip on a task row, or `null` for a task carrying no reward —
 * which is the drawn LATER row.
 *
 * `points_awarded` is the column `confirm_task_completion` sets, so it is the
 * one honest signal that the ledger moved. A `COMPLETED` row still awaiting an
 * officer's confirm therefore keeps the gold chip: it has earned nothing yet,
 * and drawing the green check would claim an award that has not happened.
 * Canvas draws no such state — see the TODO-DESIGN in `task-row.tsx`.
 */
export function formatPointsChip(
  pointReward: number | null,
  pointsAwarded: boolean,
): PointsChip | null {
  if (pointReward === null || pointReward <= 0) return null;
  const label = `+${pointReward}`;
  return pointsAwarded
    ? { tone: "awarded", label: `${label} ✓` }
    : { tone: "offered", label };
}
