/**
 * Repeating events, as the Events lists show them (#3707): one row per series
 * (its next occurrence), and a two-week horizon with everything after it
 * under Later. Mobile reads these (#3823), and web adopts them in #3822, so
 * that a series collapses and a horizon falls the same way in each app.
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

/** What a series' row says about the series as a whole. */
export interface SeriesHead {
  /** The rule, from the head row (the only row that carries it). */
  rule: RecurrenceRule;
  /**
   * A start that shows the day the series meets on: one from the weekday (or,
   * for a monthly series, the day of the month) most of its occurrences share.
   */
  start_time: string;
  /** The name most of its occurrences carry. */
  name: string | null;
}

/**
 * The item whose key most items share. A tie goes to the larger key when
 * `largerWins`, otherwise to the key seen first.
 */
function mostCommon<T>(
  items: readonly T[],
  keyOf: (item: T) => number,
  largerWins: boolean,
): T {
  const counts = new Map<number, { item: T; count: number }>();
  for (const item of items) {
    const key = keyOf(item);
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { item, count: 1 });
  }
  let best: { key: number; item: T; count: number } | null = null;
  for (const [key, { item, count }] of counts) {
    if (
      !best ||
      count > best.count ||
      (largerWins && count === best.count && key > best.key)
    ) {
      best = { key, item, count };
    }
  }
  return best!.item;
}

/** The name most rows carry; a tie goes to the soonest row's. */
function mostCommonName(rows: readonly object[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const row of [...rows].sort(byStart)) {
    const name = text(row, "name");
    if (!name) continue;
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    if (best === null || count > (counts.get(best) ?? 0)) best = name;
  }
  return best;
}

/**
 * Each series, by series key ({@link eventSeriesKey}), for its cadence and
 * name. The rule is the head's; the day and the name are what most of the
 * series' occurrences agree on, never one row's alone. A single "This event
 * only" edit moves or renames one row, the head included, and must not
 * relabel the series: a head moved to a Monday leaves a series that still
 * meets on Sundays, and a monthly series on the 31st whose shorter months the
 * API clamps to the 30th still meets on the 31st (a monthly tie goes to the
 * later day; a weekly one to the head's).
 * A series whose head carries a rule this app doesn't know is left out.
 */
export function seriesHeads(
  events: readonly object[],
): Map<string, SeriesHead> {
  const rules = new Map<string, RecurrenceRule>();
  const members = new Map<string, object[]>();
  for (const event of events) {
    const id = text(event, "id");
    const rule = field(event, "recurrence_rule");
    if (id && isRecurrenceRule(rule)) rules.set(id, rule);
    const key = eventSeriesKey(event);
    if (key && startOf(event)) {
      const list = members.get(key);
      if (list) list.push(event);
      else members.set(key, [event]);
    }
  }

  const heads = new Map<string, SeriesHead>();
  for (const [key, rule] of rules) {
    const rows = members.get(key);
    if (!rows) continue;
    // The head first, so a weekday tie keeps the head's day; a monthly tie
    // takes the later day, since the API only ever clamps a day earlier.
    const ordered = [...rows].sort((a, b) =>
      text(a, "id") === key ? -1 : text(b, "id") === key ? 1 : 0,
    );
    const monthly = rule === "MONTHLY";
    const anchor = mostCommon(
      ordered,
      (row) => (monthly ? startOf(row)!.getDate() : startOf(row)!.getDay()),
      monthly,
    );
    heads.set(key, {
      rule,
      start_time: text(anchor, "start_time")!,
      name: mostCommonName(rows),
    });
  }
  return heads;
}

/**
 * How often `event`'s series meets ("Every Sunday"), from {@link seriesHeads},
 * never from `event`'s own start: an occurrence the API clamped to the 30th,
 * or one an officer moved to a Monday, belongs to a series that still meets on
 * the 31st or on Sundays. `null` for a one-time event or a series without its
 * head in `heads`.
 */
export function seriesCadence(
  heads: ReadonlyMap<string, SeriesHead>,
  event: object,
): string | null {
  const key = eventSeriesKey(event);
  const head = key ? heads.get(key) : undefined;
  return head ? seriesCadenceLabel(head.rule, head.start_time) : null;
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
  /** {@link seriesCadence} for the row: "Every Sunday", or `null`. */
  cadence: string | null;
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
  const heads = seriesHeads(events);
  const entry = (event: T, series: T[] | null): CollapsedEvent<T> => {
    return { event, series, cadence: seriesCadence(heads, event) };
  };

  const out: CollapsedEvent<T>[] = [];
  const upcoming = new Map<string, T[]>();
  for (const event of [...events].sort(byStart)) {
    const key = eventSeriesKey(event);
    const start = startOf(event);
    if (!key || !start || start.getTime() <= now.getTime()) {
      out.push(entry(event, null));
      continue;
    }
    const members = upcoming.get(key);
    if (members) {
      members.push(event);
    } else {
      const series = [event];
      upcoming.set(key, series);
      out.push(entry(event, series));
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
 * How often a series meets, as a member says it, from its rule and its head's
 * start ({@link seriesCadence} finds both): `"Every Sunday"`,
 * `"Every other Sunday"`, `"Every month on the 9th"`.
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
