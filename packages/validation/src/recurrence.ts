/**
 * The recurrence rules a Frapp event may carry.
 *
 * Lives here rather than in `@repo/formatting` because `apps/api` and
 * `apps/mobile` both depend on this package (formatting is mobile-only),
 * and because this is the same kind of shared domain catalog as `time-zone.ts`
 * and `notification-categories.ts` — a list the server validates against and
 * the clients render from, which must not exist twice.
 */

/**
 * The only rules `EventSeriesService` can generate a series from. A value outside
 * this list is rejected with a 400 by the event DTOs; `null` is separately
 * allowed and clears a series.
 */
export const RECURRENCE_RULES = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;

export type RecurrenceRule = (typeof RECURRENCE_RULES)[number];

/**
 * Human labels for the rule picker, so the only UI that creates recurring
 * events renders exactly the set the API accepts. Kept beside the catalog
 * because a rule added without a label is then a compile error rather than a
 * value the dropdown silently omits.
 */
export const RECURRENCE_RULE_LABELS: Record<RecurrenceRule, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
};

/**
 * The rule as a calendar app says it ("Every week"), for the Repeat pickers.
 * {@link RECURRENCE_RULE_LABELS} stays the short form a list badge uses.
 */
export const RECURRENCE_REPEAT_LABELS: Record<RecurrenceRule, string> = {
  WEEKLY: "Every week",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Every month",
};

/**
 * How many *child* occurrences the API materializes for a rule.
 *
 * These are children only — `EventSeriesService.buildOccurrencePayloads` loops from
 * `i = 1`, so the parent row is itself the series' first occurrence and is not
 * counted here; {@link recurrenceMeetingCount} adds it back.
 */
const CHILD_OCCURRENCE_COUNT: Record<RecurrenceRule, number> = {
  WEEKLY: 12,
  BIWEEKLY: 6,
  MONTHLY: 6,
};

export function isRecurrenceRule(value: unknown): value is RecurrenceRule {
  return (
    typeof value === "string" &&
    (RECURRENCE_RULES as readonly string[]).includes(value)
  );
}

/**
 * Number of generated child occurrences for a rule, or `null` when the value is
 * not a rule this app generates from.
 *
 * `EventSeriesService.occurrenceCountFor` delegates here so the series the API
 * *materializes* and the count the Repeat pickers *promise* cannot drift
 * apart — changing one number changes both.
 */
export function recurrenceChildCount(
  rule: string | null | undefined,
): number | null {
  return isRecurrenceRule(rule) ? CHILD_OCCURRENCE_COUNT[rule] : null;
}

/**
 * How many meetings a new series holds, its first included: what a Repeat
 * picker tells the officer ("13 meetings"), since the series is not open-ended.
 */
export function recurrenceMeetingCount(
  rule: string | null | undefined,
): number | null {
  return isRecurrenceRule(rule) ? CHILD_OCCURRENCE_COUNT[rule] + 1 : null;
}

/**
 * The start of a new series' last meeting, stepped the way
 * `EventSeriesService.buildOccurrencePayloads` steps it (a monthly series on
 * the 31st lands on each month's last day), so the editor can say when the
 * series ends. `null` for a value that is not a rule.
 */
export function recurrenceLastStart(
  start: Date,
  rule: string | null | undefined,
): Date | null {
  if (!isRecurrenceRule(rule)) return null;
  const steps = CHILD_OCCURRENCE_COUNT[rule];
  const last = new Date(start);
  switch (rule) {
    case "WEEKLY":
      last.setDate(last.getDate() + steps * 7);
      return last;
    case "BIWEEKLY":
      last.setDate(last.getDate() + steps * 14);
      return last;
    case "MONTHLY": {
      last.setDate(1);
      last.setMonth(start.getMonth() + steps);
      const maxDay = new Date(
        last.getFullYear(),
        last.getMonth() + 1,
        0,
      ).getDate();
      last.setDate(Math.min(start.getDate(), maxDay));
      return last;
    }
  }
}

/**
 * How long a new series runs, for the line under a Repeat picker: "13
 * meetings, the last on Feb 5." (the year added when it differs). `null` for
 * a value that is not a rule.
 */
export function describeSeriesLength(
  start: Date,
  rule: string | null | undefined,
): string | null {
  const count = recurrenceMeetingCount(rule);
  const last = recurrenceLastStart(start, rule);
  if (count === null || last === null) return null;
  const day = last.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(last.getFullYear() !== start.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${count} meetings, the last on ${day}.`;
}
