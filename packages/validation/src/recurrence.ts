/**
 * The recurrence rules a Frapp event may carry, and their RFC 5545 form.
 *
 * Lives here rather than in `@repo/formatting` because `apps/api` and
 * `apps/mobile` both already depend on this package (formatting is mobile-only),
 * and because this is the same kind of shared domain catalog as `time-zone.ts`
 * and `notification-categories.ts` — a list the server validates against and
 * the clients render from, which must not exist twice.
 */

/**
 * The only rules `EventService` can generate a series from. A value outside
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
 * How many *child* occurrences the API materializes for a rule.
 *
 * These are children only — `EventService.buildOccurrencePayloads` loops from
 * `i = 1`, so the parent row is itself the series' first occurrence and is not
 * counted here. That distinction is the whole reason `toRRuleValue` adds one below.
 */
const CHILD_OCCURRENCE_COUNT: Record<RecurrenceRule, number> = {
  WEEKLY: 12,
  BIWEEKLY: 6,
  MONTHLY: 6,
};

/**
 * The `FREQ` clause per rule. `BIWEEKLY` is not an RFC 5545 frequency — the
 * standard spells it as a weekly rule with an interval.
 */
const RRULE_FREQUENCY: Record<RecurrenceRule, string> = {
  WEEKLY: "FREQ=WEEKLY",
  BIWEEKLY: "FREQ=WEEKLY;INTERVAL=2",
  MONTHLY: "FREQ=MONTHLY",
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
 * `EventService.occurrenceCountFor` delegates here so the series the API
 * *materializes* and the series an exported `.ics` *describes* cannot drift
 * apart — changing one number now changes both.
 */
export function recurrenceChildCount(rule: string | null | undefined): number | null {
  return isRecurrenceRule(rule) ? CHILD_OCCURRENCE_COUNT[rule] : null;
}

/**
 * The `RRULE` property value for a recurrence rule, or `null` when the value is
 * not one this app generates from.
 *
 * `COUNT` is children **+ 1** deliberately. RFC 5545 §3.8.5.3: "The DTSTART
 * property value always counts as the first occurrence." The parent event is
 * the `DTSTART` occurrence, so emitting the raw child count would drop the last
 * meeting of every series from the importing calendar.
 *
 * Returns `null` instead of throwing for an unknown rule because `generateIcs`
 * runs against arbitrary stored rows, and the generator already *tolerates* an
 * unrecognized rule (`recurrenceChildCount` → `null`, zero occurrences). An
 * export should degrade to a single `VEVENT` the same way rather than failing
 * the member's download over a value the rest of the system shrugs at.
 *
 * Module-private: `toRRuleLine` is the single public way to build the line, so
 * a future exporter cannot emit a bare value with no `RRULE:` prefix, and any
 * folding or escaping added later applies to every caller at once.
 */
function toRRuleValue(rule: string | null | undefined): string | null {
  if (!isRecurrenceRule(rule)) return null;
  return `${RRULE_FREQUENCY[rule]};COUNT=${CHILD_OCCURRENCE_COUNT[rule] + 1}`;
}

/**
 * The full `RRULE:` line for a recurrence rule, or `null` when the value is not
 * one this app generates from. Convenience over {@link toRRuleValue} for the
 * two `.ics` builders, which emit whole lines.
 */
export function toRRuleLine(rule: string | null | undefined): string | null {
  const value = toRRuleValue(rule);
  return value === null ? null : `RRULE:${value}`;
}
