/**
 * Repeating events, as the Events lists show them (#3707): one row per series
 * (its next occurrence), and a two-week horizon with everything after it
 * under Later. Web (#3822) and mobile (#3823) both read these, so a series
 * collapses and a horizon falls the same way in each app.
 *
 * A series on the wire is one head row (`recurrence_rule` set,
 * `parent_event_id` null) plus the occurrences the API generated from it
 * (`recurrence_rule` null, `parent_event_id` the head's id):
 * `EventSeriesService.buildOccurrencePayloads`. The head is itself the
 * series' first occurrence. `GET /v1/events` returns them all as separate
 * rows, so without collapsing a weekly meeting fills the list twelve times.
 *
 * Rows are read loosely (`object`) because web keeps the payload as
 * `Record<string, unknown>` and mobile narrows it first; both shapes pass.
 */
import { dayDelta, parseInstant } from "@repo/formatting";
import { isRecurrenceRule, type RecurrenceRule } from "@repo/validation";

/** Today through the end of the 14th day after it is "soon" (#3707). */
export const EVENT_HORIZON_DAYS = 14;

function field(event: object, key: string): unknown {
  return (event as Record<string, unknown>)[key];
}

function text(event: object, key: string): string | null {
  const value = field(event, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function startOf(event: object): Date | null {
  return parseInstant(field(event, "start_time"));
}

/** Soonest first; an unreadable start sorts last rather than throwing. */
function byStart(a: object, b: object): number {
  const left = startOf(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const right = startOf(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  return left - right;
}

/**
 * Which series a row belongs to, named by its head's id: the head's own id,
 * a generated occurrence's `parent_event_id`, or `null` for a one-time event.
 */
export function eventSeriesKey(event: object): string | null {
  const parent = text(event, "parent_event_id");
  if (parent) return parent;
  return text(event, "recurrence_rule") ? text(event, "id") : null;
}

export interface CollapsedEvent<T> {
  /** The row to draw: a one-time event, a started occurrence, or a series' next one. */
  event: T;
  /**
   * For a series row, every occurrence of the series that hasn't started,
   * soonest first and `event` included. `null` for a one-time event and for a
   * started occurrence, which stands as its own row.
   */
  series: T[] | null;
  /**
   * The series' rule, read off its head row, for {@link seriesCadenceLabel}.
   * `null` for a one-time event, or when the head isn't among `events` or
   * carries a rule this app doesn't know.
   */
  rule: RecurrenceRule | null;
}

/**
 * Collapses each series to one row, its earliest occurrence that hasn't
 * started. Occurrences that have started stay as their own rows, since each
 * is a meeting with its own attendance. The result is soonest first.
 *
 * `events` should be the whole payload: the rule lives on the head row, and a
 * head that has already started is still where the label comes from.
 */
export function collapseSeries<T extends object>(
  events: readonly T[],
  now: Date,
): CollapsedEvent<T>[] {
  const rules = new Map<string, RecurrenceRule>();
  for (const event of events) {
    const id = text(event, "id");
    const rule = field(event, "recurrence_rule");
    if (id && isRecurrenceRule(rule)) rules.set(id, rule);
  }

  const out: CollapsedEvent<T>[] = [];
  const upcoming = new Map<string, T[]>();
  for (const event of [...events].sort(byStart)) {
    const key = eventSeriesKey(event);
    const start = startOf(event);
    if (!key || !start || start.getTime() <= now.getTime()) {
      out.push({
        event,
        series: null,
        rule: key ? (rules.get(key) ?? null) : null,
      });
      continue;
    }
    const members = upcoming.get(key);
    if (members) {
      members.push(event);
    } else {
      const series = [event];
      upcoming.set(key, series);
      out.push({ event, series, rule: rules.get(key) ?? null });
    }
  }
  return out.sort((a, b) => byStart(a.event, b.event));
}

/**
 * Splits rows at the horizon: `soon` is today through the end of the
 * {@link EVENT_HORIZON_DAYS}th day after it, by calendar day (`dayDelta`), and
 * `later` is everything after. A row before today (a meeting still open for
 * check-in after midnight) is soon; an unreadable start is later.
 */
export function splitByHorizon<T extends { event: object }>(
  entries: readonly T[],
  now: Date,
): { soon: T[]; later: T[] } {
  const soon: T[] = [];
  const later: T[] = [];
  for (const entry of entries) {
    const start = startOf(entry.event);
    (start && dayDelta(now, start) <= EVENT_HORIZON_DAYS ? soon : later).push(
      entry,
    );
  }
  return { soon, later };
}

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * How often a series meets, as a member says it, from the occurrence on
 * screen: `"Every Sunday"`, `"Every other Sunday"`, `"Every month on the 9th"`.
 * `null` for a one-time event or an unreadable start.
 */
export function seriesCadenceLabel(
  rule: unknown,
  start: unknown,
): string | null {
  if (!isRecurrenceRule(rule)) return null;
  const at = start instanceof Date ? start : parseInstant(start);
  if (!at || Number.isNaN(at.getTime())) return null;
  const weekday = at.toLocaleDateString(undefined, { weekday: "long" });
  switch (rule) {
    case "WEEKLY":
      return `Every ${weekday}`;
    case "BIWEEKLY":
      return `Every other ${weekday}`;
    case "MONTHLY":
      return `Every month on the ${ordinal(at.getDate())}`;
    default: {
      const unhandled: never = rule;
      return unhandled;
    }
  }
}
