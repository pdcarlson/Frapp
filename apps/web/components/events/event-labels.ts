import {
  RECURRENCE_RULE_LABELS,
  describeRepeatPattern,
  isRecurrenceRule,
} from "@repo/validation";
import { ruleTokenLabel } from "@repo/hooks/event-series";
import {
  formatDayTime,
  formatTimeOfDay,
  localIsoDate,
  parseInstant,
} from "@repo/formatting";

/**
 * The words the Events surface prints for its own enum tokens and counts, in
 * one place so the list row, the detail sheet and the attendance panel agree.
 */

/**
 * `WEEKLY` → `"Weekly"`, through the catalog the editor's picker already uses.
 * `null` for an event that does not repeat: the row and the sheet print no
 * cadence at all for a one-time event rather than a "One-time" badge, because
 * an absent value is absent (`spec/ui/web-dashboard/README.md` § Page grammar).
 *
 * A structured rule (#4488) reads as its pattern ("Every Mon and Thu");
 * `start`, the series' first meeting, names a by-date monthly rule's day
 * when the rule doesn't. A token outside the catalog (the API rejects one,
 * but a row written before a rule was retired could still carry it) reads in
 * sentence case rather than as the raw enum.
 */
export function recurrenceLabel(rule: unknown, start?: unknown): string | null {
  if (typeof rule !== "string" || rule.trim() === "") return null;
  if (isRecurrenceRule(rule)) return RECURRENCE_RULE_LABELS[rule];
  const at = typeof start === "string" ? start : "";
  return describeRepeatPattern(rule, at) ?? ruleTokenLabel(rule);
}

/** `"1 point"`, `"5 points"`; `null` when the event awards none. */
export function pointsLabel(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `${value} ${value === 1 ? "point" : "points"}`;
}

/**
 * `"Checked in 5:03 PM"`: the panel is already scoped to one event, so the
 * check-in's day is said only when it differs from the event's own day
 * (`"Checked in Sat, Nov 7 · 12:10 AM"`). `null` when there is no readable
 * check-in time, so the line drops out rather than printing a dash.
 */
export function checkInLabel(
  checkInTime: unknown,
  eventStart: unknown,
  now: Date = new Date(),
): string | null {
  const at = parseInstant(checkInTime);
  if (!at) return null;
  const start = parseInstant(eventStart);
  if (start && localIsoDate(start) === localIsoDate(at)) {
    return `Checked in ${formatTimeOfDay(checkInTime)}`;
  }
  const dayTime = formatDayTime(checkInTime, now);
  return dayTime ? `Checked in ${dayTime}` : null;
}
