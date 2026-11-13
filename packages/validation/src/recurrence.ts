/**
 * The repeat rules a Frapp event may carry, and how a series is stepped from
 * one: the one place the API's series generator and both apps' Repeat
 * controls read, so the meetings the server makes and the caption an officer
 * reads cannot describe different series.
 *
 * Lives here rather than in `@repo/formatting` because `apps/api` and
 * `apps/mobile` both depend on this package (formatting is mobile-only),
 * and because this is the same kind of shared domain catalog as `time-zone.ts`
 * and `notification-categories.ts` — a list the server validates against and
 * the clients render from, which must not exist twice.
 *
 * ## Two spellings of `recurrence_rule` (#4488, #3662)
 *
 * - **Legacy tokens** `WEEKLY`, `BIWEEKLY`, `MONTHLY`: what every series held
 *   before 2026-11 and what shipped phone builds still send. A token has no
 *   end of its own; it makes a fixed number of meetings after the first
 *   (12, 6, 6). Still accepted and still read, so no row needs migrating.
 *   A token carries no zone, so the caller names the one it steps in
 *   ({@link SeriesStepOptions}): the API passes the creating officer's, so a
 *   7 PM weekly meeting stays at 7 PM across a DST change (#4505); without
 *   one it steps in UTC, as the API did before.
 * - **A structured rule**, a subset of iCalendar's RRULE (RFC 5545) written as
 *   `KEY=VALUE` pairs joined by `;`, for example
 *   `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=20;TZID=America/New_York`.
 *   Keys: `FREQ` (`DAILY`, `WEEKLY`, `MONTHLY`), `INTERVAL` (every N),
 *   `BYDAY` (weekly: the days, `MO,TH`; monthly: the nth weekday, `2TU`, or
 *   `-1FR` for the last), exactly one of `COUNT` (meetings, the first
 *   included) or `UNTIL` (`YYYYMMDD`, the last day a meeting may fall on, in
 *   the rule's zone), and `TZID` (the zone whose wall clock the series keeps,
 *   so a 7 PM meeting stays at 7 PM across a DST change). Chapters keep no
 *   zone of their own, so the zone is the creating officer's, which is
 *   the chapter's in practice. A monthly rule without `BYDAY` meets on its
 *   `BYMONTHDAY` (1-31; the 31st falls back to a short month's last day), so
 *   a head clamped to Feb 28 still hands on the 31st; without either, on the
 *   first meeting's day of the month. A weekly rule must name its days.
 *
 * Both Repeat controls send a structured rule, except where a token makes
 * exactly the same meetings (one of the three patterns at its own length, on
 * a run no DST change moves), because shipped phone builds read only tokens
 * (`legacyTokenFor` in `repeat-draft.ts`).
 *
 * The head row is always the series' first meeting; the rule makes the
 * meetings after it.
 */

import { isSupportedTimeZone, localTimeZone } from "./time-zone";

/**
 * The legacy tokens. Shipped phone builds send and read only these, so the
 * API keeps accepting them, and the current Repeat controls still send one
 * where it makes exactly the meetings the structured rule would
 * (`legacyTokenFor` in `repeat-draft.ts`).
 */
export const RECURRENCE_RULES = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;

export type RecurrenceRule = (typeof RECURRENCE_RULES)[number];

/** Short labels for a legacy token, for a list badge. */
export const RECURRENCE_RULE_LABELS: Record<RecurrenceRule, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
};

/** A legacy token as a calendar app says it ("Every week"). */
export const RECURRENCE_REPEAT_LABELS: Record<RecurrenceRule, string> = {
  WEEKLY: "Every week",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Every month",
};

/**
 * How many meetings after the first a legacy token makes. The series is
 * re-made this long from "now" whenever a series edit regenerates it.
 */
export const LEGACY_CHILD_COUNT: Record<RecurrenceRule, number> = {
  WEEKLY: 12,
  BIWEEKLY: 6,
  MONTHLY: 6,
};

/** Whether `value` is one of the legacy tokens. */
export function isRecurrenceRule(value: unknown): value is RecurrenceRule {
  return (
    typeof value === "string" &&
    (RECURRENCE_RULES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The structured rule
// ---------------------------------------------------------------------------

/** Weekday codes, indexed like `Date#getDay()` (Sunday first). */
export const WEEKDAY_CODES = [
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export const REPEAT_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type RepeatFrequency = (typeof REPEAT_FREQUENCIES)[number];

/** Which week of the month a monthly rule meets in; `-1` is the last. */
export const NTH_WEEKS = [1, 2, 3, 4, -1] as const;
export type NthWeek = (typeof NTH_WEEKS)[number];

/**
 * The most meetings one series may hold, its first included. Every meeting is
 * a row written in one insert, so this bounds that write; it is two a week for
 * a school year with room to spare.
 */
export const MAX_SERIES_MEETINGS = 120;

/** The largest "every N" a rule may say. */
export const MAX_REPEAT_INTERVAL = 30;

/** Longest rule string the API stores. */
export const MAX_REPEAT_RULE_LENGTH = 200;

/** How a series ends. */
export type RepeatEnd =
  | { kind: "count"; count: number }
  /** `until` is `YYYY-MM-DD`, inclusive, in the rule's zone. */
  | { kind: "until"; until: string };

/** A structured rule as the editors build it. */
export interface RepeatRule {
  freq: RepeatFrequency;
  interval: number;
  /** Weekly only: the days it meets, at least one. Ignored otherwise. */
  byDay: WeekdayCode[];
  /** Monthly only: meet on the nth weekday; `null` meets on the day of month. */
  nthWeekday: { n: NthWeek; day: WeekdayCode } | null;
  /**
   * Monthly by date only: the day of the month it meets on (1-31), written as
   * `BYMONTHDAY`. `null` reads the first meeting's day, which a clamped head
   * (Feb 28 for a series on the 31st) gets wrong, so writers set it.
   */
  monthDay: number | null;
  end: RepeatEnd;
  /** The zone whose wall clock the series keeps (IANA name). */
  timeZone: string;
}

/**
 * Any rule read back: a structured one, or a legacy token read as the
 * equivalent pattern with its fixed, rolling length. A token's `timeZone` is
 * the UTC default; the stepper takes the caller's zone over it
 * ({@link SeriesStepOptions}).
 */
export type ParsedRepeatRule =
  | (RepeatRule & { legacy: null })
  | (Omit<RepeatRule, "end" | "timeZone"> & {
      legacy: RecurrenceRule;
      end: { kind: "rolling"; children: number };
      timeZone: "UTC";
    });

function legacyRule(token: RecurrenceRule): ParsedRepeatRule {
  return {
    legacy: token,
    freq: token === "MONTHLY" ? "MONTHLY" : "WEEKLY",
    interval: token === "BIWEEKLY" ? 2 : 1,
    // A legacy weekly series meets on its first meeting's weekday; the
    // stepper reads an empty list that way.
    byDay: [],
    nthWeekday: null,
    monthDay: null,
    end: { kind: "rolling", children: LEGACY_CHILD_COUNT[token] },
    timeZone: "UTC",
  };
}

const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;
const NTH_PATTERN = /^(-1|[1-4])(SU|MO|TU|WE|TH|FR|SA)$/;
const POSITIVE_INT = /^[1-9]\d{0,3}$/;
const MONTH_DAY = /^([1-9]|[12]\d|3[01])$/;

function isWeekdayCode(value: string): value is WeekdayCode {
  return (WEEKDAY_CODES as readonly string[]).includes(value);
}

function validDate(y: number, m: number, d: number): boolean {
  const at = new Date(Date.UTC(y, m - 1, d));
  return (
    at.getUTCFullYear() === y &&
    at.getUTCMonth() === m - 1 &&
    at.getUTCDate() === d
  );
}

/**
 * Read a stored or submitted rule. `null` when it is neither a legacy token
 * nor a structured rule this module can step, so the API can refuse it with a
 * 400 before writing anything.
 */
export function parseRepeatRule(value: unknown): ParsedRepeatRule | null {
  if (typeof value !== "string") return null;
  if (isRecurrenceRule(value)) return legacyRule(value);
  if (value.length === 0 || value.length > MAX_REPEAT_RULE_LENGTH) return null;

  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const key = part.slice(0, eq);
    if (fields.has(key)) return null;
    fields.set(key, part.slice(eq + 1));
  }
  for (const key of fields.keys()) {
    if (
      ![
        "FREQ",
        "INTERVAL",
        "BYDAY",
        "BYMONTHDAY",
        "COUNT",
        "UNTIL",
        "TZID",
      ].includes(key)
    ) {
      return null;
    }
  }

  const freq = fields.get("FREQ");
  if (!freq || !(REPEAT_FREQUENCIES as readonly string[]).includes(freq)) {
    return null;
  }

  const intervalText = fields.get("INTERVAL") ?? "1";
  if (!POSITIVE_INT.test(intervalText)) return null;
  const interval = Number(intervalText);
  if (interval > MAX_REPEAT_INTERVAL) return null;

  const zoneText = fields.get("TZID");
  // Untrimmed is refused rather than trimmed: the zone check trims, Intl
  // doesn't, so " America/New_York" would pass here and throw when stepped.
  if (!zoneText || zoneText !== zoneText.trim()) return null;
  if (!isSupportedTimeZone(zoneText)) return null;
  const timeZone = canonicalZone(zoneText);

  const countText = fields.get("COUNT");
  const untilText = fields.get("UNTIL");
  if ((countText === undefined) === (untilText === undefined)) return null;
  let end: RepeatEnd;
  if (countText !== undefined) {
    if (!POSITIVE_INT.test(countText)) return null;
    const count = Number(countText);
    if (count < 2 || count > MAX_SERIES_MEETINGS) return null;
    end = { kind: "count", count };
  } else {
    const match = UNTIL_PATTERN.exec(untilText ?? "");
    if (!match) return null;
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (!validDate(y, m, d)) return null;
    end = { kind: "until", until: `${match[1]}-${match[2]}-${match[3]}` };
  }

  const byDayText = fields.get("BYDAY");
  const monthDayText = fields.get("BYMONTHDAY");
  let byDay: WeekdayCode[] = [];
  let nthWeekday: RepeatRule["nthWeekday"] = null;
  let monthDay: number | null = null;
  if (monthDayText !== undefined) {
    // By date or by weekday, never both.
    if (freq !== "MONTHLY" || byDayText !== undefined) return null;
    if (!MONTH_DAY.test(monthDayText)) return null;
    monthDay = Number(monthDayText);
  }
  if (freq === "WEEKLY") {
    if (!byDayText) return null;
    const days = byDayText.split(",");
    if (!days.every(isWeekdayCode)) return null;
    if (new Set(days).size !== days.length) return null;
    byDay = WEEKDAY_CODES.filter((code) => days.includes(code));
  } else if (freq === "MONTHLY") {
    if (byDayText !== undefined) {
      const match = NTH_PATTERN.exec(byDayText);
      if (!match) return null;
      nthWeekday = {
        n: Number(match[1]) as NthWeek,
        day: match[2] as WeekdayCode,
      };
    }
  } else if (byDayText !== undefined) {
    return null;
  }

  return {
    legacy: null,
    freq: freq as RepeatFrequency,
    interval,
    byDay,
    nthWeekday,
    monthDay,
    end,
    timeZone,
  };
}

/**
 * The runtime's own spelling of a zone (`america/new_york` and `US/Eastern`
 * both read `America/New_York`), so every spelling of one zone steps through
 * one cached formatter rather than one each (`formatterFor`).
 */
function canonicalZone(timeZone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions()
        .timeZone ?? timeZone
    );
  } catch {
    return timeZone;
  }
}

/** Whether the API accepts `value` as a `recurrence_rule`. */
export function isRepeatRule(value: unknown): value is string {
  return parseRepeatRule(value) !== null;
}

/** Write a structured rule in its one canonical spelling. */
export function formatRepeatRule(rule: RepeatRule): string {
  const parts = [`FREQ=${rule.freq}`, `INTERVAL=${rule.interval}`];
  if (rule.freq === "WEEKLY") {
    const days = WEEKDAY_CODES.filter((code) => rule.byDay.includes(code));
    parts.push(`BYDAY=${days.join(",")}`);
  } else if (rule.freq === "MONTHLY" && rule.nthWeekday) {
    parts.push(`BYDAY=${rule.nthWeekday.n}${rule.nthWeekday.day}`);
  } else if (rule.freq === "MONTHLY" && rule.monthDay !== null) {
    parts.push(`BYMONTHDAY=${rule.monthDay}`);
  }
  if (rule.end.kind === "count") parts.push(`COUNT=${rule.end.count}`);
  else parts.push(`UNTIL=${rule.end.until.replace(/-/g, "")}`);
  parts.push(`TZID=${rule.timeZone}`);
  return parts.join(";");
}

// ---------------------------------------------------------------------------
// Wall-clock arithmetic in a zone
// ---------------------------------------------------------------------------

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Far more than the zones in use. Rules carry canonical names, but a reader's
 * zone (push copy) arrives as stored, so the cache is bounded rather than
 * trusted to stay small.
 */
const MAX_CACHED_FORMATTERS = 512;

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    if (formatters.size >= MAX_CACHED_FORMATTERS) formatters.clear();
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** What a wall clock in `timeZone` reads at `instant`. */
function wallClockAt(instant: number, timeZone: string): WallClock {
  if (timeZone === "UTC") {
    const at = new Date(instant);
    return {
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      day: at.getUTCDate(),
      hour: at.getUTCHours(),
      minute: at.getUTCMinutes(),
      second: at.getUTCSeconds(),
      ms: at.getUTCMilliseconds(),
    };
  }
  const read: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") read[part.type] = Number(part.value);
  }
  return {
    year: read.year!,
    month: read.month!,
    day: read.day!,
    hour: read.hour! % 24,
    minute: read.minute!,
    second: read.second!,
    ms: new Date(instant).getUTCMilliseconds(),
  };
}

function wallAsUtc(clock: WallClock): number {
  return Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
    clock.ms,
  );
}

/** The zone's offset from UTC at `instant`, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  return wallAsUtc(wallClockAt(instant, timeZone)) - instant;
}

const HALF_DAY_MS = 12 * 3_600_000;

/**
 * The instant a wall clock in `timeZone` reads `clock`. A time skipped by a
 * spring-forward change (2:30 AM in the gap) lands after the gap, at the
 * same distance past it (3:30 AM), as calendar apps do; a time a fall-back
 * change repeats takes its first reading.
 *
 * The two offsets in play are the zone's half a day either side, which no
 * real zone changes twice within. Each gives a candidate instant; a candidate
 * whose own offset agrees with the one it was made from reads `clock`.
 */
function instantAt(clock: WallClock, timeZone: string): number {
  const guess = wallAsUtc(clock);
  const before = offsetAt(guess - HALF_DAY_MS, timeZone);
  const after = offsetAt(guess + HALF_DAY_MS, timeZone);
  const readsClock = (offset: number) =>
    offsetAt(guess - offset, timeZone) === offset;
  const valid = [before, after].filter(readsClock);
  // Overlap: both read the clock; the larger offset is the earlier instant.
  if (valid.length > 0) return guess - Math.max(...valid);
  // Gap: neither does. The smaller offset lands after it.
  return guess - Math.min(before, after);
}

/** A calendar day as a day number (days since 1970-01-01). */
function dayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function fromDayNumber(n: number): {
  year: number;
  month: number;
  day: number;
} {
  const at = new Date(n * 86_400_000);
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
  };
}

function weekdayOf(n: number): number {
  // 1970-01-01 was a Thursday (4).
  return (((n + 4) % 7) + 7) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The day of month the nth `weekday` of a month falls on. */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  n: NthWeek,
  weekday: number,
): number {
  if (n === -1) {
    const last = daysInMonth(year, month);
    const lastWeekday = weekdayOf(dayNumber(year, month, last));
    return last - ((lastWeekday - weekday + 7) % 7);
  }
  const firstWeekday = weekdayOf(dayNumber(year, month, 1));
  return 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
}

/**
 * Bounds every scan, in steps of the rule's interval (not in days, weeks or
 * months, which a large interval would use up long before a full series): a
 * rule that matches rarely (a monthly rule whose meetings all fall before
 * `skipBefore`) still terminates.
 */
const MAX_SCAN_STEPS = 2_000;

/**
 * The calendar days after the first meeting's that the pattern meets on, in
 * order, with no end applied.
 */
function* patternDays(
  rule: ParsedRepeatRule,
  first: WallClock,
): Generator<number> {
  const firstDay = dayNumber(first.year, first.month, first.day);
  if (rule.freq === "DAILY") {
    for (let k = 1; k <= MAX_SCAN_STEPS; k++)
      yield firstDay + k * rule.interval;
    return;
  }
  if (rule.freq === "WEEKLY") {
    const days =
      rule.byDay.length > 0
        ? rule.byDay.map((code) => WEEKDAY_CODES.indexOf(code))
        : [weekdayOf(firstDay)];
    // Weeks run Sunday to Saturday, as the S M T W T F S chips read.
    const weekStart = firstDay - weekdayOf(firstDay);
    for (let i = 0; i <= MAX_SCAN_STEPS; i++) {
      const w = i * rule.interval;
      for (const weekday of days) {
        const day = weekStart + w * 7 + weekday;
        if (day > firstDay) yield day;
      }
    }
    return;
  }
  // MONTHLY
  for (let i = 0; i <= MAX_SCAN_STEPS; i++) {
    const k = i * rule.interval;
    const monthIndex = first.month - 1 + k;
    const year = first.year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const dayOfMonth = rule.nthWeekday
      ? nthWeekdayOfMonth(
          year,
          month,
          rule.nthWeekday.n,
          WEEKDAY_CODES.indexOf(rule.nthWeekday.day),
        )
      : Math.min(rule.monthDay ?? first.day, daysInMonth(year, month));
    const day = dayNumber(year, month, dayOfMonth);
    if (day > firstDay) yield day;
  }
}

function untilDayNumber(until: string): number {
  const [y, m, d] = until.split("-").map(Number);
  return dayNumber(y!, m!, d!);
}

/** How a caller steps a series whose rule is a legacy token. */
export interface SeriesStepOptions {
  /**
   * The zone whose wall clock a legacy token keeps (IANA name): the API
   * passes the series creator's, a caption the reader's. Missing, `null` or
   * not a zone this runtime knows steps in UTC, as tokens always did. A
   * structured rule ignores it and keeps its own `TZID`.
   */
  legacyTimeZone?: string | null;
}

/** The zone a parsed rule steps in. */
function stepZone(rule: ParsedRepeatRule, options: SeriesStepOptions): string {
  if (!rule.legacy) return rule.timeZone;
  const zone = options.legacyTimeZone;
  return zone && zone === zone.trim() && isSupportedTimeZone(zone)
    ? canonicalZone(zone)
    : "UTC";
}

/**
 * The starts of a series' meetings after its first, as the API writes them.
 *
 * - `COUNT` makes `count - 1` meetings after the first; `UNTIL` makes every
 *   meeting on or before that day. Both are fixed from the first meeting, so
 *   regenerating a series from `skipBefore` drops the ones already past
 *   rather than adding more at the end.
 * - A legacy token makes its fixed number of meetings *after* `skipBefore`,
 *   which is how the API always regenerated one, on the wall clock of
 *   `options.legacyTimeZone` (UTC without one).
 *
 * Never more than {@link MAX_SERIES_MEETINGS} - 1 (the cap is checked on write
 * by {@link checkSeriesLength}). `null` for a rule this module can't read.
 */
export function seriesChildStarts(
  rule: string | null | undefined,
  start: Date | string,
  skipBefore?: number,
  options: SeriesStepOptions = {},
): Date[] | null {
  const parsed = parseRepeatRule(rule);
  const firstMs = new Date(start).getTime();
  if (!parsed || Number.isNaN(firstMs)) return null;
  const timeZone = stepZone(parsed, options);
  const first = wallClockAt(firstMs, timeZone);
  const limit = MAX_SERIES_MEETINGS - 1;
  const until =
    parsed.end.kind === "until" ? untilDayNumber(parsed.end.until) : null;

  const starts: Date[] = [];
  let made = 0;
  for (const day of patternDays(parsed, first)) {
    if (until !== null && day > until) break;
    if (parsed.end.kind === "count" && made >= parsed.end.count - 1) break;
    if (made >= limit) break;
    const date = fromDayNumber(day);
    const instant = instantAt({ ...first, ...date }, timeZone);
    if (parsed.end.kind !== "rolling") made += 1;
    if (skipBefore !== undefined && instant <= skipBefore) continue;
    starts.push(new Date(instant));
    if (parsed.end.kind === "rolling") {
      made += 1;
      if (made >= parsed.end.children) break;
    }
  }
  return starts;
}

/**
 * Why a new or rescheduled series can't be written as asked, in words an
 * officer reads, or `null` when it can. An `UNTIL` that leaves no meeting
 * after the first, and one that would make more than
 * {@link MAX_SERIES_MEETINGS}, are refused rather than silently cut short.
 */
export function checkSeriesLength(
  rule: string | null | undefined,
  start: Date | string,
): string | null {
  const parsed = parseRepeatRule(rule);
  if (!parsed) return "That repeat rule can't be read.";
  if (parsed.end.kind !== "until") return null;
  const firstMs = new Date(start).getTime();
  if (Number.isNaN(firstMs)) return null;
  const first = wallClockAt(firstMs, parsed.timeZone);
  const until = untilDayNumber(parsed.end.until);
  let count = 1;
  for (const day of patternDays(parsed, first)) {
    if (day > until) break;
    count += 1;
    if (count > MAX_SERIES_MEETINGS) {
      return `A series can hold at most ${MAX_SERIES_MEETINGS} meetings. Choose an earlier end date.`;
    }
  }
  if (count < 2) {
    return "The end date leaves no meeting after the first. Choose a later end date.";
  }
  return null;
}

/**
 * How many meetings a new series holds, its first included, and when the
 * last one starts. `null` for a rule this module can't read.
 */
export function seriesExtent(
  start: Date,
  rule: string | null | undefined,
  options: SeriesStepOptions = {},
): { count: number; last: Date } | null {
  const children = seriesChildStarts(rule, start, undefined, options);
  if (children === null) return null;
  return {
    count: children.length + 1,
    last: children[children.length - 1] ?? new Date(start),
  };
}

/**
 * How long a new series runs, for the line under a Repeat control: "13
 * meetings, the last on Feb 5." (the year added when it differs). Dates read
 * in the rule's zone. A legacy token is stepped and read in
 * `options.legacyTimeZone`, or the device's zone without one: the zone the
 * API steps it in is its creator's, which for a new series is this device's
 * (#4505). `null` for a value that is not a rule.
 */
export function describeSeriesLength(
  start: Date,
  rule: string | null | undefined,
  options: SeriesStepOptions = {},
): string | null {
  const parsed = parseRepeatRule(rule);
  if (!parsed) return null;
  const timeZone = stepZone(parsed, {
    legacyTimeZone: options.legacyTimeZone ?? localTimeZone(),
  });
  const extent = seriesExtent(start, rule, { legacyTimeZone: timeZone });
  if (!extent) return null;
  const year = (at: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(at);
  const day = extent.last.toLocaleDateString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(year(extent.last) !== year(start) ? { year: "numeric" } : {}),
  });
  return `${extent.count} meetings, the last on ${day}.`;
}

// ---------------------------------------------------------------------------
// Saying the pattern
// ---------------------------------------------------------------------------

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const WEEKDAY_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
const NTH_WORDS: Record<NthWeek, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};

/** "1st", "2nd", "11th", "23rd": a day of the month as said aloud. */
export function ordinal(day: number): string {
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

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "Every weekday" for Monday to Friday, else the days named. */
function weekdaysPhrase(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join(",") === "1,2,3,4,5") return "weekday";
  if (sorted.length === 1) return WEEKDAY_LONG[sorted[0]!]!;
  return joinWords(sorted.map((d) => WEEKDAY_SHORT[d]!));
}

/** "the second Tuesday", "the last Friday". */
export function nthWeekdayPhrase(nth: {
  n: NthWeek;
  day: WeekdayCode;
}): string {
  return `the ${NTH_WORDS[nth.n]} ${WEEKDAY_LONG[WEEKDAY_CODES.indexOf(nth.day)]}`;
}

/**
 * The nth weekday a calendar day is in its month: what "the second Tuesday"
 * names. A day in the month's last week answers `-1` when `preferLast`, and
 * always when it is the fifth of its weekday.
 */
function nthWeekdayAt(
  clock: Pick<WallClock, "year" | "month" | "day">,
  preferLast: boolean,
): { n: NthWeek; day: WeekdayCode } {
  const weekday = weekdayOf(dayNumber(clock.year, clock.month, clock.day));
  const week = Math.ceil(clock.day / 7);
  const inLastWeek = clock.day + 7 > daysInMonth(clock.year, clock.month);
  const n: NthWeek =
    week >= 5 || (preferLast && inLastWeek) ? -1 : (week as NthWeek);
  return { n, day: WEEKDAY_CODES[weekday]! };
}

/**
 * Weekdays moved `days` later (earlier when negative), in week order: what a
 * weekly rule's days become when its first meeting moves. The one place the
 * API's `shiftRepeatRule` and the editors' Repeat control shift days.
 */
export function shiftWeekdays(
  days: readonly WeekdayCode[],
  by: number,
): WeekdayCode[] {
  const moved = new Set(
    days.map(
      (code) =>
        WEEKDAY_CODES[(((WEEKDAY_CODES.indexOf(code) + by) % 7) + 7) % 7]!,
    ),
  );
  return WEEKDAY_CODES.filter((code) => moved.has(code));
}

/** A calendar day as a wall clock in some zone reads it. */
export interface ZonedCalendarDay {
  year: number;
  month: number;
  day: number;
  weekday: WeekdayCode;
  /** Days since 1970-01-01, for day arithmetic. */
  dayNumber: number;
  daysInMonth: number;
}

/**
 * The calendar day `at` falls on in `timeZone`, through the cached formatter
 * the series stepping uses, so a Repeat control reading it on every render
 * builds no formatter of its own.
 */
export function zonedCalendarDay(
  at: Date | number,
  timeZone: string,
): ZonedCalendarDay {
  const clock = wallClockAt(new Date(at).getTime(), timeZone);
  const n = dayNumber(clock.year, clock.month, clock.day);
  return {
    year: clock.year,
    month: clock.month,
    day: clock.day,
    weekday: WEEKDAY_CODES[weekdayOf(n)]!,
    dayNumber: n,
    daysInMonth: daysInMonth(clock.year, clock.month),
  };
}

/** The day number of `instant` on the wall clock of `timeZone`. */
function zonedDayNumber(instant: number, timeZone: string): number {
  const clock = wallClockAt(instant, timeZone);
  return dayNumber(clock.year, clock.month, clock.day);
}

/**
 * How a structured rule says when it repeats: "Every Mon and Thu", "Every
 * other Tuesday", "Every 3 weeks on Wednesday", "Every month on the second
 * Tuesday", "Every 2 months on the 9th", "Every day". `start` (the first
 * meeting) supplies the day of the month a by-date monthly rule without
 * `BYMONTHDAY` meets on. `null` for a legacy token or anything unreadable,
 * which callers describe their own way.
 *
 * - `timeZone` says it as a reader in that zone sees it: a meeting at 11 PM
 *   Monday in New York is Tuesday in Berlin, so its days move with the
 *   first meeting's (push copy names the recipient's own day).
 * - `monthDay` stands in for a by-date monthly rule's missing `BYMONTHDAY`
 *   (the series' usual day, when the caller holds its meetings).
 */
export function describeRepeatPattern(
  rule: unknown,
  start: Date | string,
  options: { timeZone?: string; monthDay?: number | null } = {},
): string | null {
  const parsed = parseRepeatRule(rule);
  if (!parsed || parsed.legacy) return null;
  const startMs = new Date(start).getTime();
  // How many days the reader's calendar is ahead of the rule's at the first
  // meeting: -1, 0 or 1.
  const shift =
    options.timeZone && !Number.isNaN(startMs)
      ? zonedDayNumber(startMs, options.timeZone) -
        zonedDayNumber(startMs, parsed.timeZone)
      : 0;
  const shiftWeekday = (weekday: number) => (((weekday + shift) % 7) + 7) % 7;
  const n = parsed.interval;
  switch (parsed.freq) {
    case "DAILY":
      return n === 1 ? "Every day" : `Every ${n} days`;
    case "WEEKLY": {
      const days = weekdaysPhrase(
        parsed.byDay.map((code) => shiftWeekday(WEEKDAY_CODES.indexOf(code))),
      );
      if (n === 1) return `Every ${days}`;
      if (n === 2) return `Every other ${days}`;
      return `Every ${n} weeks on ${days}`;
    }
    case "MONTHLY": {
      const every = n === 1 ? "Every month" : `Every ${n} months`;
      // The first meeting as the reader sees it. In a zone where it falls on
      // another day, a monthly rule can't be restated exactly (the day after
      // the second Tuesday is sometimes the third Wednesday, and the day
      // after the 31st is the 1st or the 31st), so it names that meeting's
      // own day there, as the legacy MONTHLY copy always has.
      const seen = Number.isNaN(startMs)
        ? null
        : wallClockAt(startMs, options.timeZone ?? parsed.timeZone);
      if (parsed.nthWeekday) {
        if (shift === 0 || !seen) {
          return `${every} on ${nthWeekdayPhrase(parsed.nthWeekday)}`;
        }
        return `${every} on ${nthWeekdayPhrase(nthWeekdayAt(seen, parsed.nthWeekday.n === -1))}`;
      }
      const day =
        parsed.monthDay !== null
          ? shift === 0 || !seen
            ? parsed.monthDay
            : seen.day
          : (options.monthDay ?? seen?.day ?? null);
      if (day === null) return every;
      return `${every} on the ${ordinal(day)}`;
    }
  }
}

/**
 * The rule a series carries once it is handed from its head, which started
 * at `headStart`, to the later meeting that started at `nextStart` (a started
 * head split off by a series edit, or a head canceled on its own).
 *
 * - The meetings that left are counted by their place in the pattern, not by
 *   the rows still standing, so a meeting canceled on its own still counts
 *   as used. A `COUNT` drops by them, or the next regeneration would add
 *   that many at the end.
 * - `null` when fewer than two meetings of the pattern would remain, whether
 *   it ends by `COUNT` or `UNTIL`, so the new head stands alone rather than
 *   carrying a rule it can't satisfy.
 * - A by-date monthly rule without `BYMONTHDAY` gains the old head's day, so
 *   a new head clamped to a short month (Feb 28 for the 31st) doesn't move
 *   the series to its own day.
 * - A legacy token, or a rule this module can't read, is returned as it was.
 */
export function advanceRepeatRule(
  rule: string | null,
  headStart: Date | string,
  nextStart: Date | string,
): string | null {
  const parsed = parseRepeatRule(rule);
  if (!parsed || parsed.legacy) return rule;
  const headMs = new Date(headStart).getTime();
  const nextMs = new Date(nextStart).getTime();
  if (Number.isNaN(headMs) || Number.isNaN(nextMs)) return rule;
  const children = seriesChildStarts(rule, headStart) ?? [];
  const used = 1 + children.filter((at) => at.getTime() < nextMs).length;
  const remaining = children.length + 1 - used;
  if (remaining < 2) return null;
  let next: RepeatRule = parsed;
  if (parsed.end.kind === "count") {
    next = { ...next, end: { kind: "count", count: remaining } };
  }
  if (
    parsed.freq === "MONTHLY" &&
    !parsed.nthWeekday &&
    parsed.monthDay === null
  ) {
    next = { ...next, monthDay: wallClockAt(headMs, parsed.timeZone).day };
  }
  return formatRepeatRule(next);
}

/**
 * The rule a series carries when its head moves from `fromStart` to
 * `toStart` and the caller kept the rule: the days a structured rule names
 * move with the head, as rescheduling a recurring meeting means. A weekly
 * rule's days move by the days the head moved; a monthly rule's day of the
 * month, or nth weekday, becomes the new head's. A legacy token, a daily
 * rule, a move within the same day, or a rule this module can't read, is
 * returned as it was.
 */
export function shiftRepeatRule(
  rule: string | null,
  fromStart: Date | string,
  toStart: Date | string,
): string | null {
  const parsed = parseRepeatRule(rule);
  if (!parsed || parsed.legacy) return rule;
  const fromMs = new Date(fromStart).getTime();
  const toMs = new Date(toStart).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return rule;
  const to = wallClockAt(toMs, parsed.timeZone);
  const days =
    dayNumber(to.year, to.month, to.day) -
    zonedDayNumber(fromMs, parsed.timeZone);
  if (days === 0) return rule;
  let next: RepeatRule = parsed;
  if (parsed.freq === "WEEKLY") {
    next = { ...next, byDay: shiftWeekdays(parsed.byDay, days) };
  } else if (parsed.freq === "MONTHLY") {
    if (parsed.nthWeekday) {
      next = {
        ...next,
        nthWeekday: nthWeekdayAt(to, parsed.nthWeekday.n === -1),
      };
    } else if (parsed.monthDay !== null) {
      next = { ...next, monthDay: to.day };
    }
  } else {
    return rule;
  }
  return formatRepeatRule(next);
}
