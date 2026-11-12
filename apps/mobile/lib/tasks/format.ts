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

import {
  dayDelta,
  formatDueLabel,
  formatDueOn,
  formatPointsChip as pointsChipLabel,
  parseInstant,
  parseInstantOrBareLocalNoon,
} from "@repo/formatting";

export { isDueUrgent } from "@/components/chat/up-next-strip";

/**
 * A bare `YYYY-MM-DD` parsed at local **noon**.
 *
 * Midnight would render as the previous day for anyone west of Greenwich, and a
 * task due the 22nd must not read "Due Aug 21". Same reasoning, same fix as
 * `formatDate` in `lib/more/service-hours.ts`.
 */
export function parseTaskDate(value: string): Date | null {
  // A full timestamp passes through untouched: appending `T12:00:00` to one
  // yields `NaN`, and the chat `kind:"task"` payload can carry either shape.
  // Protected cluster — local noon for bare dates, not formatLocaleDate's
  // `new Date(value)` (UTC midnight).
  return parseInstantOrBareLocalNoon(value);
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
 * The subtitle under an open task's title: `@repo/formatting`'s countdown
 * ("Due today", "Due Friday", "Overdue by 2 days", "Due today at 5 PM" for a
 * task due at a time, #4003), the one web's chat task card reads too (#4135).
 *
 * Returns `null` for a date it cannot read, so the row draws a title with no
 * subtitle rather than "Invalid Date" — `narrow.ts` states the same
 * preference. The caller keeps the row: dropping a task the member owes is
 * worse than an odd-looking one.
 */
export function formatDueSubtitle(
  dueDate: string | null,
  now: Date,
): string | null {
  return dueDate ? formatDueLabel(dueDate, now) : null;
}

/**
 * The plain due date, "Due Nov 6", with no countdown. For a task whose
 * countdown would not be true, such as one already done: the chat task card
 * draws it once the live task is finished, or when the viewer can't read it.
 * `null` for a date this module cannot read, as `formatDueSubtitle` returns.
 * The year shows outside `now`'s year, as everywhere else in the app.
 */
export function formatDueDate(
  dueDate: string | null,
  now: Date = new Date(),
): string | null {
  return dueDate ? formatDueOn(dueDate, now) : null;
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
  const label = pointsChipLabel(pointReward);
  return pointsAwarded
    ? { tone: "awarded", label: `${label} ✓` }
    : { tone: "offered", label };
}
