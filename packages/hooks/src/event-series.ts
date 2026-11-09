/**
 * Repeating events as an Events list shows them: one row per series, and a
 * two-week horizon (#3707). Shared by web's Events page and mobile's Events
 * tab so both apps collapse a series, and draw the horizon, the same way.
 *
 * A series is stored as rows, one per meeting (`spec/behavior/events.md`
 * § Recurring events): the head carries the `recurrence_rule` and is itself
 * the first meeting, and each generated occurrence points at the head through
 * `parent_event_id` with a `null` rule. So the rule says nothing about a
 * generated occurrence; the series key below is what groups them.
 *
 * Pure functions over plain rows: no React, no query.
 */

/** The fields this module reads off an event row. */
export type SeriesEventLike = {
  id?: unknown;
  start_time?: unknown;
  recurrence_rule?: unknown;
  parent_event_id?: unknown;
};

/** One list row: the occurrence it shows, and its series when it has one. */
export type EventListEntry<T> = {
  event: T;
  /**
   * The series' occurrences that haven't started, soonest first, `event`
   * included. `null` for a one-time event, or for a meeting that already
   * happened, which stays its own row.
   */
  series: T[] | null;
};

/** Today through the end of the fourteenth day after it (#3707). */
export const EVENT_HORIZON_DAYS = 14;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function startMs(event: SeriesEventLike): number | null {
  if (typeof event.start_time !== "string") return null;
  const ms = Date.parse(event.start_time);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Which series a row belongs to: the head's id. `null` for a one-time event,
 * and for an occurrence detached into a standalone event (no parent, no rule).
 */
export function eventSeriesKey(event: SeriesEventLike): string | null {
  const parent = nonEmptyString(event.parent_event_id);
  if (parent) return parent;
  const id = nonEmptyString(event.id);
  return id && nonEmptyString(event.recurrence_rule) ? id : null;
}

/** Whether the row is a meeting of a repeating series, head or generated. */
export function isSeriesEvent(event: SeriesEventLike): boolean {
  return eventSeriesKey(event) !== null;
}

/**
 * The series' rule, read off whichever row carries it (the head). `null` when
 * the head isn't among `events`.
 */
export function seriesRuleOf(
  key: string,
  events: readonly SeriesEventLike[],
): string | null {
  for (const event of events) {
    if (nonEmptyString(event.id) === key) {
      return nonEmptyString(event.recurrence_rule);
    }
  }
  return null;
}

/**
 * One row per series: its soonest occurrence that hasn't started, carrying the
 * rest of its upcoming occurrences. A meeting that already happened, and a
 * row whose start can't be read, stays its own row: each past meeting has its
 * own attendance, which is what an officer opens it for.
 *
 * Order is kept: the entry sits where its shown occurrence sat in `events`.
 */
export function collapseSeries<T extends SeriesEventLike>(
  events: readonly T[],
  now: number,
): EventListEntry<T>[] {
  const upcomingBySeries = new Map<string, T[]>();
  for (const event of events) {
    const key = eventSeriesKey(event);
    const start = startMs(event);
    if (key === null || start === null || start < now) continue;
    const members = upcomingBySeries.get(key);
    if (members) members.push(event);
    else upcomingBySeries.set(key, [event]);
  }
  for (const members of upcomingBySeries.values()) {
    members.sort((a, b) => (startMs(a) ?? 0) - (startMs(b) ?? 0));
  }

  const entries: EventListEntry<T>[] = [];
  for (const event of events) {
    const key = eventSeriesKey(event);
    const members = key === null ? undefined : upcomingBySeries.get(key);
    if (!members || !members.includes(event)) {
      entries.push({ event, series: null });
      continue;
    }
    if (members[0] === event) entries.push({ event, series: members });
  }
  return entries;
}

/**
 * The first instant past the horizon: local midnight starting the fifteenth
 * day after `now`'s, so "today through the next 14 days" holds whole days.
 */
export function horizonEnd(
  now: number,
  days: number = EVENT_HORIZON_DAYS,
): number {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + days + 1);
  return end.getTime();
}

/**
 * Splits entries at the horizon. An entry whose start can't be read stays in
 * `soon`: it may be close, and hiding it behind Later would lose it.
 */
export function splitByHorizon<T extends SeriesEventLike>(
  entries: readonly EventListEntry<T>[],
  now: number,
  days: number = EVENT_HORIZON_DAYS,
): { soon: EventListEntry<T>[]; later: EventListEntry<T>[] } {
  const end = horizonEnd(now, days);
  const soon: EventListEntry<T>[] = [];
  const later: EventListEntry<T>[] = [];
  for (const entry of entries) {
    const start = startMs(entry.event);
    if (start !== null && start >= end) later.push(entry);
    else soon.push(entry);
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
 * How a series row says when it repeats, from its rule and an occurrence's
 * start: `"Every Sunday"`, `"Every other Sunday"`, `"Every month on the 9th"`.
 * `null` for a rule this app doesn't generate or a start it can't read, so
 * the caller leaves the cadence out rather than guessing.
 */
export function seriesCadenceLabel(
  rule: unknown,
  start: unknown,
): string | null {
  if (typeof start !== "string") return null;
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return null;
  const weekday = at.toLocaleDateString("en-US", { weekday: "long" });
  switch (rule) {
    case "WEEKLY":
      return `Every ${weekday}`;
    case "BIWEEKLY":
      return `Every other ${weekday}`;
    case "MONTHLY":
      return `Every month on the ${ordinal(at.getDate())}`;
    default:
      return null;
  }
}
