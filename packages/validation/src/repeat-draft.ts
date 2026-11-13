/**
 * The Repeat control's state, shared by the web editor and the phone's New
 * event sheet (#4488, #3662), so both read a stored rule back, default a new
 * one and turn what the officer picked into a `recurrence_rule` the same way.
 *
 * The control: a preset row (Doesn't repeat / Daily / Weekly / Monthly), and
 * under a cadence its options, open by default (Shawn, 2026-11-12): weekday
 * chips and "Every N weeks" for Weekly; "Every N months" and on the day of
 * the month or the nth weekday for Monthly; and Ends, on a date or after N
 * meetings, for every cadence. The comparable apps are Google Calendar's and
 * Apple Calendar's custom repeat, without their extra "Custom…" step.
 *
 * Number fields are held as typed text, so a cleared field stays cleared
 * while the officer types; {@link repeatRuleOf} reads them on save.
 */

import {
  LEGACY_CHILD_COUNT,
  MAX_REPEAT_INTERVAL,
  MAX_SERIES_MEETINGS,
  RECURRENCE_REPEAT_LABELS,
  WEEKDAY_CODES,
  checkSeriesLength,
  describeRepeatPattern,
  describeSeriesLength,
  formatRepeatRule,
  nthWeekdayPhrase,
  parseRepeatRule,
  advanceRepeatRule,
  seriesChildStarts,
  shiftRepeatRule,
  shiftWeekdays,
  zonedCalendarDay,
  type NthWeek,
  type RepeatFrequency,
  type RecurrenceRule,
  type RepeatRule,
  type WeekdayCode,
  type ZonedCalendarDay,
} from "./recurrence";
import { localTimeZone } from "./time-zone";

/** The preset row, left to right. */
export const REPEAT_PRESETS = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type RepeatPreset = (typeof REPEAT_PRESETS)[number];

export const REPEAT_PRESET_LABELS: Record<RepeatPreset, string> = {
  NONE: "Doesn't repeat",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
};

/** The weekday chips' letters and their spoken names, Sunday first. */
export const REPEAT_DAY_LETTERS: Record<WeekdayCode, string> = {
  SU: "S",
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
};
export const REPEAT_DAY_NAMES: Record<WeekdayCode, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

/**
 * How many meetings a new series holds when the officer doesn't say, its
 * first included: weekly and monthly keep the lengths the legacy `WEEKLY`
 * and `MONTHLY` tokens make (12 and 6 after the first), daily a week. So an
 * untouched Weekly or Monthly is exactly a token and is sent as one
 * ({@link repeatRuleOf}).
 */
export const REPEAT_DEFAULT_COUNT: Record<RepeatFrequency, number> = {
  DAILY: 7,
  WEEKLY: 13,
  MONTHLY: 7,
};

/** Monthly by the day of the month, the nth weekday, or the last weekday. */
export type MonthlyBy = "date" | "nth" | "last";

export interface RepeatDraft {
  preset: RepeatPreset;
  /** "Every N", as typed. */
  intervalInput: string;
  /** Weekly days; `null` follows the first meeting's weekday as it moves. */
  byDay: WeekdayCode[] | null;
  monthlyBy: MonthlyBy;
  /**
   * A stored by-date rule's day of the month, kept so a series on the 31st
   * whose first meeting fell on a short month's last day stays on the 31st.
   * `null` meets on the first meeting's day.
   */
  monthDay: number | null;
  endKind: "count" | "until";
  /** "After N meetings", as typed. */
  countInput: string;
  /** "On" date, `YYYY-MM-DD` in the series' zone; `""` until picked. */
  until: string;
  /** The zone the series keeps its wall-clock time in. */
  timeZone: string;
  /**
   * The stored rule this draft was read from. While {@link pristine}, a save
   * sends it back unchanged, so opening a legacy series and saving something
   * else doesn't rewrite its rule, which would rebuild the series.
   */
  source: string | null;
  pristine: boolean;
}

/** A one-time event's draft. */
export function noRepeatDraft(timeZone: string = localTimeZone()): RepeatDraft {
  return {
    preset: "NONE",
    intervalInput: "1",
    byDay: null,
    monthlyBy: "date",
    monthDay: null,
    endKind: "count",
    countInput: String(REPEAT_DEFAULT_COUNT.WEEKLY),
    until: "",
    timeZone,
    source: null,
    pristine: true,
  };
}

/**
 * A stored `recurrence_rule` read into the control, to prefill an editor.
 * A legacy token reads as its pattern with its fixed length as a count; a
 * value that isn't a rule reads as one-time.
 */
export function repeatDraftFromRule(
  rule: string | null | undefined,
  timeZone: string = localTimeZone(),
): RepeatDraft {
  const parsed = parseRepeatRule(rule);
  const base = noRepeatDraft(timeZone);
  if (!parsed || !rule) return base;
  const draft: RepeatDraft = {
    ...base,
    preset: parsed.freq,
    intervalInput: String(parsed.interval),
    byDay: parsed.byDay.length > 0 ? [...parsed.byDay] : null,
    monthlyBy: parsed.nthWeekday
      ? parsed.nthWeekday.n === -1
        ? "last"
        : "nth"
      : "date",
    monthDay: parsed.monthDay,
    source: rule,
  };
  if (parsed.legacy) {
    return {
      ...draft,
      countInput: String(parsed.end.children + 1),
    };
  }
  return {
    ...draft,
    timeZone: parsed.timeZone,
    endKind: parsed.end.kind,
    countInput:
      parsed.end.kind === "count"
        ? String(parsed.end.count)
        : String(REPEAT_DEFAULT_COUNT[parsed.freq]),
    until: parsed.end.kind === "until" ? parsed.end.until : "",
  };
}

/** Any change the officer makes: the draft stops standing for its source. */
export function editRepeatDraft(
  draft: RepeatDraft,
  patch: Partial<
    Pick<
      RepeatDraft,
      "intervalInput" | "byDay" | "monthlyBy" | "countInput" | "until"
    >
  >,
): RepeatDraft {
  return { ...draft, ...patch, pristine: false };
}

/**
 * Picking a preset: its options start from their defaults (every 1, the
 * first meeting's weekday, the day of the month, the cadence's length).
 * An end date already picked is kept.
 */
export function pickRepeatPreset(
  draft: RepeatDraft,
  preset: RepeatPreset,
): RepeatDraft {
  if (preset === draft.preset) return draft;
  return {
    ...draft,
    preset,
    intervalInput: "1",
    byDay: null,
    monthlyBy: "date",
    monthDay: null,
    countInput:
      preset === "NONE"
        ? draft.countInput
        : String(REPEAT_DEFAULT_COUNT[preset]),
    pristine: false,
  };
}

/**
 * Choosing how it ends. Switching to a date the first time offers the day
 * the current count would end on, as Google Calendar does, or the first
 * meeting's own day when the count can't say (the caption then asks for a
 * later one). Never no day: a date picker shows some day, and one the
 * draft doesn't hold couldn't be picked (iOS reports only a change).
 */
export function pickRepeatEnd(
  draft: RepeatDraft,
  endKind: RepeatDraft["endKind"],
  start: Date,
): RepeatDraft {
  if (endKind === draft.endKind) return draft;
  let until = draft.until;
  if (endKind === "until" && until === "") {
    until = defaultUntil(draft, start) ?? dayString(start, draft.timeZone);
  }
  return { ...draft, endKind, until, pristine: false };
}

/** Toggling a weekday chip. The last chip stays on: a week needs a day. */
export function toggleRepeatDay(
  draft: RepeatDraft,
  day: WeekdayCode,
  start: Date,
): RepeatDraft {
  const current = repeatDays(draft, start);
  const next = current.includes(day)
    ? current.filter((code) => code !== day)
    : WEEKDAY_CODES.filter((code) => code === day || current.includes(code));
  if (next.length === 0) return draft;
  return editRepeatDraft(draft, { byDay: next });
}

/** The weekly days the chips show on. */
export function repeatDays(draft: RepeatDraft, start: Date): WeekdayCode[] {
  return draft.byDay ?? [zonedCalendarDay(start, draft.timeZone).weekday];
}

// ---------------------------------------------------------------------------
// The first meeting's day, in the series' zone
// ---------------------------------------------------------------------------

/**
 * Which week of its month a day is in: the nth (1 to 5; a fifth has no
 * "every month" equivalent but "last"), and whether it is the month's last
 * such weekday.
 */
function weekOfMonth(day: ZonedCalendarDay): { n: number; isLast: boolean } {
  return { n: Math.ceil(day.day / 7), isLast: day.day + 7 > day.daysInMonth };
}

/**
 * The day of the month a by-date series meets on: a stored day that the
 * first meeting is that day of, or clamped to (the 31st, on Feb 28), else
 * the first meeting's own day.
 */
function monthDayFor(draft: RepeatDraft, day: ZonedCalendarDay): number {
  const kept = draft.monthDay;
  return kept !== null && Math.min(kept, day.daysInMonth) === day.day
    ? kept
    : day.day;
}

/** One "on …" choice a Monthly series offers for its first meeting. */
export interface MonthlyChoice {
  by: MonthlyBy;
  /** "day 12", "the second Tuesday", "the last Friday". */
  label: string;
}

/**
 * What Monthly can meet on, from the first meeting's day: its day of the
 * month, its nth weekday (not a fifth, which most months lack), and, in the
 * month's last week, the last such weekday.
 */
export function monthlyChoices(
  draft: RepeatDraft,
  start: Date,
): MonthlyChoice[] {
  const day = zonedCalendarDay(start, draft.timeZone);
  const { n, isLast } = weekOfMonth(day);
  const choices: MonthlyChoice[] = [
    { by: "date", label: `day ${monthDayFor(draft, day)}` },
  ];
  if (n <= 4) {
    choices.push({
      by: "nth",
      label: nthWeekdayPhrase({ n: n as NthWeek, day: day.weekday }),
    });
  }
  if (isLast) {
    choices.push({
      by: "last",
      label: nthWeekdayPhrase({ n: -1, day: day.weekday }),
    });
  }
  return choices;
}

/**
 * The monthly choice that applies, of `choices` (the first meeting's
 * {@link monthlyChoices}): one the first meeting no longer offers (it moved
 * off the last week, say) falls back to the day of the month. Both controls
 * show this one as picked, so the chip lit is the rule saved.
 */
export function monthlyByFor(
  draft: RepeatDraft,
  choices: readonly MonthlyChoice[],
): MonthlyBy {
  return choices.some((c) => c.by === draft.monthlyBy)
    ? draft.monthlyBy
    : "date";
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** Which field a problem belongs under. */
export type RepeatField = "interval" | "count" | "until" | "start";

export type RepeatRuleResult =
  | { ok: true; rule: string | null }
  | { ok: false; field: RepeatField; error: string };

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * The legacy token that makes exactly the meetings `rule` does, if one does.
 * Shipped phone builds read only tokens (they show anything else raw as the
 * cadence and treat the head as one-time), so a client sends a token where
 * it says the same series (#4488): weekly on the first meeting's weekday or
 * every 2 weeks, or monthly on its day of the month, at the token's own
 * length. The API steps a token in the saving officer's zone on file, which
 * is this device's, or in UTC when it has none (#4505), so the token is
 * compared with the rule stepped in UTC, instant by instant: a run a DST
 * change moves in the draft's zone, or a monthly series whose UTC date
 * differs, keeps the structured rule and its wall-clock time. A token that
 * matches in UTC matches in the draft's zone too, so either way the API
 * makes the meetings shown. The one gap is a zone on file that lags the
 * device's (a trip, before the next request records it).
 * What stays different is regeneration: a series edit that rebuilds a token
 * makes its run again from now, where a `COUNT` holds (spec § Recurring).
 */
function legacyTokenFor(
  rule: RepeatRule,
  start: Date,
  day: ZonedCalendarDay,
): RecurrenceRule | null {
  if (rule.end.kind !== "count") return null;
  const children = rule.end.count - 1;
  let token: RecurrenceRule | null = null;
  if (
    rule.freq === "WEEKLY" &&
    rule.byDay.length === 1 &&
    rule.byDay[0] === day.weekday
  ) {
    if (rule.interval === 1 && children === LEGACY_CHILD_COUNT.WEEKLY) {
      token = "WEEKLY";
    } else if (
      rule.interval === 2 &&
      children === LEGACY_CHILD_COUNT.BIWEEKLY
    ) {
      token = "BIWEEKLY";
    }
  } else if (
    rule.freq === "MONTHLY" &&
    rule.interval === 1 &&
    rule.nthWeekday === null &&
    rule.monthDay === day.day &&
    children === LEGACY_CHILD_COUNT.MONTHLY
  ) {
    token = "MONTHLY";
  }
  if (!token) return null;
  const ours = seriesChildStarts(formatRepeatRule(rule), start);
  const theirs = seriesChildStarts(token, start);
  const same =
    !!ours &&
    !!theirs &&
    ours.length === theirs.length &&
    ours.every((at, i) => at.getTime() === theirs[i]!.getTime());
  return same ? token : null;
}

/**
 * The `recurrence_rule` the draft says, or why it can't be saved yet. `null`
 * for a one-time event; the stored rule unchanged while the draft is
 * untouched; a legacy token where one says the same series.
 */
export function repeatRuleOf(
  draft: RepeatDraft,
  start: Date,
): RepeatRuleResult {
  if (draft.preset === "NONE") return { ok: true, rule: null };
  if (draft.pristine && draft.source) return { ok: true, rule: draft.source };

  const interval = wholeNumber(draft.intervalInput);
  if (interval === null || interval < 1 || interval > MAX_REPEAT_INTERVAL) {
    return {
      ok: false,
      field: "interval",
      error: `Repeat every 1 to ${MAX_REPEAT_INTERVAL}.`,
    };
  }

  let end: RepeatRule["end"];
  if (draft.endKind === "count") {
    const count = wholeNumber(draft.countInput);
    if (count === null || count < 2 || count > MAX_SERIES_MEETINGS) {
      return {
        ok: false,
        field: "count",
        error: `A series holds 2 to ${MAX_SERIES_MEETINGS} meetings.`,
      };
    }
    end = { kind: "count", count };
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.until)) {
      return { ok: false, field: "until", error: "Choose an end date." };
    }
    end = { kind: "until", until: draft.until };
  }

  const day = zonedCalendarDay(start, draft.timeZone);
  const monthlyBy = monthlyByFor(draft, monthlyChoices(draft, start));
  const structured: RepeatRule = {
    freq: draft.preset,
    interval,
    byDay: draft.preset === "WEEKLY" ? repeatDays(draft, start) : [],
    nthWeekday:
      draft.preset === "MONTHLY" && monthlyBy !== "date"
        ? {
            n: monthlyBy === "last" ? -1 : (weekOfMonth(day).n as NthWeek),
            day: day.weekday,
          }
        : null,
    monthDay:
      draft.preset === "MONTHLY" && monthlyBy === "date"
        ? monthDayFor(draft, day)
        : null,
    end,
    timeZone: draft.timeZone,
  };
  const rule =
    legacyTokenFor(structured, start, day) ?? formatRepeatRule(structured);

  const problem = checkSeriesLength(rule, start);
  if (problem) return { ok: false, field: "until", error: problem };
  return { ok: true, rule };
}

/**
 * The line under the control: how long the series runs ("13 meetings, the
 * last on Feb 5."), or why it can't be saved as set. `null` for a one-time
 * event.
 */
export function repeatCaption(
  draft: RepeatDraft,
  start: Date,
  /** On an edit, the series the change applies to: says what it will save. */
  series?: RepeatEditSeries,
): { text: string; problem: boolean } | null {
  const result = series
    ? repeatRuleForEdit(draft, series)
    : repeatRuleOf(draft, start);
  if (!result.ok) return { text: result.error, problem: true };
  if (!result.rule) return null;
  const from = series ? repeatEditAnchor(series) : start;
  const text = describeSeriesLength(from, result.rule, {
    legacyTimeZone: draft.timeZone,
  });
  return text ? { text, problem: false } : null;
}

/**
 * The cadence in a few words, for the "More options" summary: "Every Mon
 * and Thu", "Every month on the 12th", "Doesn't repeat".
 */
export function repeatSummary(
  draft: RepeatDraft,
  start: Date,
  /** On an edit, the series the change applies to: says what it will save. */
  series?: RepeatEditSeries,
): string {
  if (draft.preset === "NONE") return REPEAT_PRESET_LABELS.NONE;
  const result = series
    ? repeatRuleForEdit(draft, series)
    : repeatRuleOf(draft, start);
  // An untouched rule is sent as stored and moved by the API with the start.
  const rule =
    result.ok && series && result.rule === draft.source
      ? shiftRepeatRule(
          result.rule,
          series.headStart,
          new Date(series.headStart.getTime() + series.shiftMs),
        )
      : result.ok
        ? result.rule
        : null;
  const parsed = parseRepeatRule(rule);
  if (parsed?.legacy) return RECURRENCE_REPEAT_LABELS[parsed.legacy];
  return (
    (rule ? describeRepeatPattern(rule, start) : null) ??
    REPEAT_PRESET_LABELS[draft.preset]
  );
}

/** The day the draft's count would end on, `YYYY-MM-DD` in its zone. */
function defaultUntil(draft: RepeatDraft, start: Date): string | null {
  const counted = repeatRuleOf(
    { ...draft, endKind: "count", pristine: false },
    start,
  );
  const fallback = repeatRuleOf(
    {
      ...draft,
      endKind: "count",
      countInput:
        draft.preset === "NONE"
          ? String(REPEAT_DEFAULT_COUNT.WEEKLY)
          : String(REPEAT_DEFAULT_COUNT[draft.preset]),
      pristine: false,
    },
    start,
  );
  const rule = counted.ok ? counted.rule : fallback.ok ? fallback.rule : null;
  const starts = rule
    ? seriesChildStarts(rule, start, undefined, {
        legacyTimeZone: draft.timeZone,
      })
    : null;
  const last = starts?.[starts.length - 1];
  if (!last) return null;
  return dayString(last, draft.timeZone);
}

/** `YYYY-MM-DD` of `at` in `timeZone`. */
function dayString(at: Date, timeZone: string): string {
  const day = zonedCalendarDay(at, timeZone);
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Editing a series
// ---------------------------------------------------------------------------

/** The series an edit's Repeat change applies to, as the editor knows it. */
export interface RepeatEditSeries {
  /** The series' first meeting (its head) as stored. */
  headStart: Date;
  /** The head's stored rule; `null` for a one-time event. */
  headRule: string | null;
  /**
   * How far this save moves the series: the edited meeting's new start
   * less its stored one. A series save shifts the head by the same.
   */
  shiftMs: number;
  now: Date;
  /**
   * The series' real next meeting, when the editor holds its rows: the
   * earliest generated meeting after `now`, the one the API promotes when
   * it splits off a started head (`splitStartedHead`). Missing or `null`,
   * it is read from the stored rule's pattern instead.
   */
  nextStart?: Date | null;
}

/**
 * The meeting a changed rule steps from once the save lands, which the API
 * takes the rule as sent from (`EventSeriesService.updateSeries`): the head
 * moved by the save's shift, or, when the head has already started and the
 * API splits it off, the series' next meeting moved by the same shift.
 *
 * The next meeting is the real one (`nextStart`) when the editor holds the
 * series' rows (#4746). A legacy series last made before #4505, or by an
 * officer with no zone on file, was stepped in UTC, so after a DST change
 * the pattern stepped on this device's clock reads an hour off its rows,
 * and near midnight a different weekday or day of the month. Without the
 * rows it is read from the stored rule's pattern, a legacy token on this
 * device's clock as the API now steps one (#4505); the API checks the rule
 * against the real one.
 */
export function repeatEditAnchor(series: RepeatEditSeries): Date {
  const { headStart, headRule, shiftMs, now, nextStart } = series;
  if (headStart.getTime() > now.getTime() || !headRule) {
    return new Date(headStart.getTime() + shiftMs);
  }
  const next =
    nextStart ??
    seriesChildStarts(headRule, headStart, now.getTime(), {
      legacyTimeZone: localTimeZone(),
    })?.[0];
  return new Date((next ?? headStart).getTime() + shiftMs);
}

function sameDays(a: readonly WeekdayCode[], b: readonly WeekdayCode[]) {
  return a.length === b.length && a.every((code) => b.includes(code));
}

/**
 * The draft as the control shows it on an edit, so the chips, the count,
 * the caption and the rule saved all say the same series:
 *
 * - Weekdays left as stored move with a start moved in this save, as the API
 *   moves a kept rule's (`shiftRepeatRule`): a Monday series moved to
 *   Tuesday lights Tuesday.
 * - Once the head has started, a count left as stored counts what is left
 *   from the next meeting, as the API hands a kept rule on
 *   (`advanceRepeatRule`); a changed rule is taken as sent, so without this
 *   adding a weekday would quietly add the meetings already held.
 *
 * The draft's `source` and `pristine` are kept: an untouched draft still
 * sends the stored rule, which the API moves and hands on itself.
 */
export function repeatEditDraft(
  draft: RepeatDraft,
  series: RepeatEditSeries,
): RepeatDraft {
  const stored = parseRepeatRule(draft.source);
  if (draft.preset === "NONE" || !stored || stored.legacy) return draft;
  let shown = draft;
  const movedFrom = new Date(series.headStart.getTime() + series.shiftMs);
  if (
    series.shiftMs !== 0 &&
    draft.byDay &&
    sameDays(draft.byDay, stored.byDay)
  ) {
    const days =
      zonedCalendarDay(movedFrom, draft.timeZone).dayNumber -
      zonedCalendarDay(series.headStart, draft.timeZone).dayNumber;
    if (days !== 0)
      shown = { ...shown, byDay: shiftWeekdays(draft.byDay, days) };
  }
  const anchor = repeatEditAnchor(series);
  if (
    stored.end.kind === "count" &&
    draft.endKind === "count" &&
    draft.countInput.trim() === String(stored.end.count) &&
    anchor.getTime() !== movedFrom.getTime()
  ) {
    const handed = parseRepeatRule(
      advanceRepeatRule(
        draft.source,
        series.headStart,
        new Date(anchor.getTime() - series.shiftMs),
      ),
    );
    if (handed && !handed.legacy && handed.end.kind === "count") {
      shown = { ...shown, countInput: String(handed.end.count) };
    }
  }
  return shown;
}

/**
 * The rule an edit sends, as {@link repeatRuleOf} from the meeting the rule
 * will step from ({@link repeatEditAnchor}), read from what the control
 * shows ({@link repeatEditDraft}). An untouched draft gives back the stored
 * rule. A one-time event that has already started can't begin a series:
 * the series would start in the past, which the API refuses.
 */
export function repeatRuleForEdit(
  draft: RepeatDraft,
  series: RepeatEditSeries,
): RepeatRuleResult {
  const anchor = repeatEditAnchor(series);
  if (
    draft.preset !== "NONE" &&
    !series.headRule &&
    anchor.getTime() <= series.now.getTime()
  ) {
    return {
      ok: false,
      field: "start",
      error:
        "This event has started, so it can't begin a series. Make its next meeting a new event that repeats.",
    };
  }
  return repeatRuleOf(repeatEditDraft(draft, series), anchor);
}
