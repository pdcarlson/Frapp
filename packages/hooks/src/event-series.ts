/**
 * Repeating events as an Events list shows them: one row per series, and a
 * two-week horizon (#3707). Web's Events page and mobile's Events tab
 * (#3823) both read it, so both apps collapse a series, and draw the
 * horizon, the same way.
 *
 * A series is stored as rows, one per meeting (the "Recurring events" rules
 * under [`spec/behavior/events.md` § Event Creation](../../../spec/behavior/events.md#event-creation)):
 * the head carries the `recurrence_rule` and is itself
 * the first meeting, and each generated occurrence points at the head through
 * `parent_event_id` with a `null` rule. So the rule says nothing about a
 * generated occurrence; the series key below is what groups them.
 *
 * Pure functions over plain rows: no React, no query.
 */

import {
  describeRepeatPattern,
  ordinal,
  parseRepeatRule,
} from "@repo/validation";

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
 * The series' head: the row whose id is the series key, which carries the
 * rule. `null` when the head isn't among `events`.
 */
export function seriesHeadOf<T extends SeriesEventLike>(
  key: string,
  events: readonly T[],
): T | null {
  return events.find((event) => nonEmptyString(event.id) === key) ?? null;
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

/**
 * A rule token in sentence case (`DAILY` → `"Daily"`): how a rule outside the
 * catalog (one a retired rule left on an old row) reads, on the list row and
 * in web's `recurrenceLabel` alike. `null` for no rule.
 */
export function ruleTokenLabel(rule: unknown): string | null {
  const token = nonEmptyString(rule);
  if (!token) return null;
  const words = token.trim().replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The day of the month a monthly series meets on: the day most of its
 * meetings fall on, the later day on a tie. Not the head's own date, which an
 * instance edit can move or a promotion can replace with a clamped meeting
 * (a series on the 31st meets on Feb 28), and not one meeting's date, for the
 * same clamp. `null` with no readable start.
 */
function monthlyAnchorDay(starts: readonly unknown[]): number | null {
  const counts = new Map<number, number>();
  for (const start of starts) {
    if (typeof start !== "string") continue;
    const at = new Date(start);
    if (Number.isNaN(at.getTime())) continue;
    counts.set(at.getDate(), (counts.get(at.getDate()) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [day, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount && best !== null && day > best)
    ) {
      best = day;
      bestCount = count;
    }
  }
  return best;
}

/**
 * A date on the weekday most of `starts` fall on (local time), or `null`
 * when none can be read. A tie goes to the earliest start among the tied
 * weekdays, so the answer doesn't depend on input order.
 */
function majorityWeekday(starts: readonly unknown[]): Date | null {
  const byDay = new Map<number, { count: number; first: Date }>();
  for (const start of starts) {
    if (typeof start !== "string") continue;
    const at = new Date(start);
    if (Number.isNaN(at.getTime())) continue;
    const entry = byDay.get(at.getDay());
    if (!entry) byDay.set(at.getDay(), { count: 1, first: at });
    else {
      entry.count += 1;
      if (at < entry.first) entry.first = at;
    }
  }
  let best: { count: number; first: Date } | null = null;
  for (const entry of byDay.values()) {
    if (
      !best ||
      entry.count > best.count ||
      (entry.count === best.count && entry.first < best.first)
    ) {
      best = entry;
    }
  }
  return best?.first ?? null;
}

/**
 * How a series row says when it repeats, from its rule and a meeting's start:
 * `"Every Sunday"`, `"Every other Sunday"`, `"Every month on the 9th"`, and
 * for a structured rule `"Every Mon and Thu"` or `"Every month on the second
 * Tuesday"` (`describeRepeatPattern` in `@repo/validation`).
 *
 * The day it names is read from `seriesStarts` (every meeting of the series
 * the caller holds), so one meeting moved on its own doesn't rename the
 * series: the weekday most of them fall on for a weekly series, the day of the
 * month for a monthly one (`monthlyAnchorDay`). Without them it falls back to
 * `start`. A rule outside the catalog reads in sentence
 * case (`ruleTokenLabel`). `null` for a missing rule or a start it can't
 * read, so the caller leaves the cadence out rather than guessing.
 */
export function seriesCadenceLabel(
  rule: unknown,
  start: unknown,
  seriesStarts: readonly unknown[] = [],
): string | null {
  if (typeof start !== "string") return null;
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return null;
  const weekday = (majorityWeekday(seriesStarts) ?? at).toLocaleDateString(
    "en-US",
    { weekday: "long" },
  );
  switch (rule) {
    case "WEEKLY":
      return `Every ${weekday}`;
    case "BIWEEKLY":
      return `Every other ${weekday}`;
    case "MONTHLY": {
      const day = monthlyAnchorDay(seriesStarts) ?? at.getDate();
      return `Every month on the ${ordinal(day)}`;
    }
    default: {
      // A structured rule names its own days (#4488), so it reads straight
      // from the rule, the words push copy uses. A by-date monthly rule
      // without BYMONTHDAY takes the series' usual day, as MONTHLY does
      // above, not the shown meeting's, which a short month clamps.
      const parsed = parseRepeatRule(rule);
      const monthDay =
        parsed?.freq === "MONTHLY" && !parsed.nthWeekday
          ? monthlyAnchorDay(seriesStarts)
          : null;
      return (
        describeRepeatPattern(rule, at, { monthDay }) ?? ruleTokenLabel(rule)
      );
    }
  }
}
