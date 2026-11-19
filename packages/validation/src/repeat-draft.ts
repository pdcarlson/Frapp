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
  formatTaskRepeatRule,
  nextTaskRepeatDate,
  parseTaskRepeatRule,
  nthWeekdayPhrase,
  parseRepeatRule,
  advanceRepeatRule,
  seriesChildStarts,
  shiftRepeatRule,
  shiftWeekdays,
  taskCopyDueInstant,
  zonedCalendarDay,
  type NthWeek,
  type RepeatFrequency,
  type RecurrenceRule,
  type RepeatRule,
  type TaskRepeatEnd,
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
  /** How it ends. `never` is a repeating task's only (#5119). */
  endKind: "count" | "until" | "never";
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

/**
 * A proposed series read into a new event's Repeat control (Ask's card Edit,
 * #5117): its pattern and length, but following the first meeting as the
 * officer moves it, since the form is a create and nothing is stored yet. A
 * missing or unreadable rule reads as one-time.
 */
export function proposedRepeatDraft(
  rule: string | null | undefined,
  timeZone: string = localTimeZone(),
): RepeatDraft {
  const draft = repeatDraftFromRule(rule, timeZone);
  if (draft.preset === "NONE") return draft;
  return {
    ...draft,
    byDay: null,
    monthDay: null,
    source: null,
    pristine: false,
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
 * length. The API steps a token in the saving request's own zone, which is
 * this device's (#4746), else the officer's zone on file, else UTC (#4505),
 * so the token is compared with the rule stepped in UTC, instant by instant:
 * a run a DST change moves in the draft's zone, or a monthly series whose
 * UTC date differs, keeps the structured rule and its wall-clock time. A
 * token that matches in UTC matches in the draft's zone too, so either way
 * the API makes the meetings shown.
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
  if (draft.endKind === "never") {
    // Only a task's control offers it; an event series must end.
    return { ok: false, field: "until", error: "Choose how the series ends." };
  }
  const built = repeatPatternOf(draft, start, "meetings");
  if (!built.ok) return built;
  const end = built.end;
  if (end.kind === "never") {
    return { ok: false, field: "until", error: "Choose how the series ends." };
  }
  const structured: RepeatRule = { ...built.pattern, end };
  const rule =
    legacyTokenFor(structured, start, built.day) ??
    formatRepeatRule(structured);

  const problem = checkSeriesLength(rule, start);
  if (problem) return { ok: false, field: "until", error: problem };
  return { ok: true, rule };
}

/**
 * What an event's and a task's Repeat control share (#5119): the interval
 * and end read from the draft and checked, and the pattern built on the
 * first meeting's (or task's) day in the draft's zone. One builder, so the
 * same picks make the same rule on both. `counted` names what a count
 * counts, for its error.
 */
function repeatPatternOf(
  draft: RepeatDraft,
  start: Date,
  counted: "meetings" | "times",
):
  | {
      ok: true;
      pattern: Omit<RepeatRule, "end">;
      end: TaskRepeatEnd;
      day: ZonedCalendarDay;
    }
  | { ok: false; field: RepeatField; error: string } {
  const preset = draft.preset;
  if (preset === "NONE") {
    return { ok: false, field: "interval", error: "Choose how it repeats." };
  }
  const interval = wholeNumber(draft.intervalInput);
  if (interval === null || interval < 1 || interval > MAX_REPEAT_INTERVAL) {
    return {
      ok: false,
      field: "interval",
      error: `Repeat every 1 to ${MAX_REPEAT_INTERVAL}.`,
    };
  }

  let end: TaskRepeatEnd;
  if (draft.endKind === "never") {
    end = { kind: "never" };
  } else if (draft.endKind === "count") {
    const count = wholeNumber(draft.countInput);
    if (count === null || count < 2 || count > MAX_SERIES_MEETINGS) {
      return {
        ok: false,
        field: "count",
        error:
          counted === "meetings"
            ? `A series holds 2 to ${MAX_SERIES_MEETINGS} meetings.`
            : `Repeat 2 to ${MAX_SERIES_MEETINGS} times.`,
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
  return {
    ok: true,
    day,
    end,
    pattern: {
      freq: preset,
      interval,
      byDay: preset === "WEEKLY" ? repeatDays(draft, start) : [],
      nthWeekday:
        preset === "MONTHLY" && monthlyBy !== "date"
          ? {
              n: monthlyBy === "last" ? -1 : (weekOfMonth(day).n as NthWeek),
              day: day.weekday,
            }
          : null,
      monthDay:
        preset === "MONTHLY" && monthlyBy === "date"
          ? monthDayFor(draft, day)
          : null,
      timeZone: draft.timeZone,
    },
  };
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
 * series' rows (#4746): the API takes a changed rule as sent, without
 * checking its weekdays or day of the month against the meeting it promotes,
 * so a wrong anchor is saved as is. A legacy series last made before #4505,
 * or by an officer with no zone on file, was stepped in UTC, so after a DST
 * change the pattern stepped on this device's clock reads an hour off its
 * rows, and near midnight a different weekday or day of the month. Both
 * editors hold Repeat while the rows load; only when they can't be read is
 * the next meeting predicted from the stored rule's pattern, a legacy token
 * on this device's clock as the API now steps one (#4505).
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

// ---------------------------------------------------------------------------
// Repeating tasks (#5119)
// ---------------------------------------------------------------------------

/**
 * A task's Repeat control: the event control's draft, with one more way to
 * end, "Never", and that is where a new task starts. A task series makes one
 * copy at a time, so an open end writes nothing ahead
 * (`spec/behavior/tasks.md` § Repeating tasks).
 */
export function noTaskRepeatDraft(
  timeZone: string = localTimeZone(),
): RepeatDraft {
  return { ...noRepeatDraft(timeZone), endKind: "never" };
}

/** A stored task rule read into the control, to prefill an edit. */
export function taskRepeatDraftFromRule(
  rule: string | null | undefined,
  timeZone: string = localTimeZone(),
): RepeatDraft {
  const parsed = parseTaskRepeatRule(rule);
  const base = noTaskRepeatDraft(timeZone);
  if (!parsed || !rule) return base;
  return {
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
    timeZone: parsed.timeZone,
    endKind: parsed.end.kind,
    countInput:
      parsed.end.kind === "count"
        ? String(parsed.end.count)
        : String(REPEAT_DEFAULT_COUNT[parsed.freq]),
    until: parsed.end.kind === "until" ? parsed.end.until : "",
    source: rule,
  };
}

/**
 * The `recurrence_rule` a task's draft makes, its first copy due at `first`,
 * or why it can't be saved. Unlike an event's: never a legacy token (no
 * shipped build reads a task's rule), "Never" is an end, and an end date must
 * leave a copy after the first.
 */
export function taskRepeatRuleOf(
  draft: RepeatDraft,
  first: Date,
): RepeatRuleResult {
  if (draft.preset === "NONE") return { ok: true, rule: null };
  if (draft.pristine && draft.source) return { ok: true, rule: draft.source };
  const built = repeatPatternOf(draft, first, "times");
  if (!built.ok) return built;
  const rule = formatTaskRepeatRule({ ...built.pattern, end: built.end });
  const firstDay = dayString(first, draft.timeZone);
  if (!nextTaskRepeatDate(rule, firstDay, firstDay)) {
    return {
      ok: false,
      field: "until",
      error:
        "The end date leaves no task after the first. Choose a later end date.",
    };
  }
  return { ok: true, rule };
}

/**
 * How a task's draft repeats, in a line: "Every Monday", or the preset's
 * name while the draft can't be read yet. `Doesn't repeat` for none.
 */
export function taskRepeatSummary(draft: RepeatDraft, first: Date): string {
  if (draft.preset === "NONE") return REPEAT_PRESET_LABELS.NONE;
  const result = taskRepeatRuleOf(draft, first);
  return (
    (result.ok && result.rule
      ? describeRepeatPattern(result.rule, first)
      : null) ?? REPEAT_PRESET_LABELS[draft.preset]
  );
}

/**
 * The line under a task's Repeat control: a problem to fix, or how long it
 * runs ("Repeats until you stop it." / "4 times, the last on Dec 7.").
 * `null` for a task that doesn't repeat.
 */
export function taskRepeatCaption(
  draft: RepeatDraft,
  first: Date,
): { text: string; problem: boolean } | null {
  const result = taskRepeatRuleOf(draft, first);
  if (!result.ok) return { text: result.error, problem: true };
  if (!result.rule) return null;
  const parsed = parseTaskRepeatRule(result.rule);
  if (!parsed || parsed.end.kind === "never") {
    return { text: "Repeats until you stop it.", problem: false };
  }
  if (parsed.end.kind === "until") {
    // An end date can be years away and isn't capped for tasks, so it says
    // the date rather than stepping every copy to count them.
    return {
      text: `Repeats until ${shortDay(parsed.end.until, first, draft.timeZone)}.`,
      problem: false,
    };
  }
  // A count is at most MAX_SERIES_MEETINGS: step the parsed rule to its last.
  const firstDay = dayString(first, draft.timeZone);
  let last = firstDay;
  for (let n = 1; n < parsed.end.count; n++) {
    const next = nextTaskRepeatDate(parsed, firstDay, last);
    if (!next) break;
    last = next;
  }
  return {
    text: `${parsed.end.count} times, the last on ${shortDay(last, first, draft.timeZone)}.`,
    problem: false,
  };
}

/** `YYYY-MM-DD` as "Dec 7", with the year when it isn't `ref`'s. */
function shortDay(day: string, ref: Date, timeZone: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === dayString(ref, timeZone).slice(0, 4);
  return at.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * The moment a task typed as a due entry (`YYYY-MM-DD`, or with `THH:MM`) is
 * due, for its Repeat control (#5119): the weekday and day of the month it
 * defaults to. A timed entry reads on this device's clock, as the task forms
 * save it. An untimed day reads at noon in `timeZone`, the zone the Repeat
 * steps in (an edit's is the stored rule's), so it is the day the officer
 * picked there whatever this device's zone; without one, at local noon.
 * `null` until the entry reads as a day. Shared by both apps' task forms.
 */
export function taskFirstDue(entry: string, timeZone?: string): Date | null {
  // A time only as the forms type it (`THH:MM`); a stored timestamp's tail
  // isn't one, and reads as its day.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})$)?/.exec(entry);
  if (!match) return null;
  const [, year, month, day, hours, minutes] = match;
  const at =
    hours !== undefined && minutes !== undefined
      ? new Date(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hours),
          Number(minutes),
        )
      : timeZone
        ? taskCopyDueInstant(`${year}-${month}-${day}`, "12:00:00", timeZone)
        : new Date(Number(year), Number(month) - 1, Number(day), 12);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * How often a copy of a repeating task comes, in a word for a phone row's
 * status line (#5119): "Daily", "Weekly", "Monthly", or "Every 2 weeks" past
 * an interval of one. `null` for a task with no live series.
 */
export function taskRepeatCadence(
  series: TaskSeriesLine | null | undefined,
): string | null {
  if (!series || !taskSeriesLive(series)) return null;
  const parsed = parseTaskRepeatRule(series.recurrence_rule);
  if (!parsed) return null;
  if (parsed.interval === 1) return REPEAT_PRESET_LABELS[parsed.freq];
  const unit =
    parsed.freq === "DAILY"
      ? "days"
      : parsed.freq === "WEEKLY"
        ? "weeks"
        : "months";
  return `Every ${parsed.interval} ${unit}`;
}

/** What a task read says about its series (`TaskSeriesSummaryDto`). */
export interface TaskSeriesLine {
  recurrence_rule: string;
  next_due_date: string;
  ended: boolean;
}

/**
 * Whether a task is a copy of a series that still makes copies (#5119):
 * what decides the repeat mark, the Repeat field and the scope question on
 * both apps.
 */
export function taskSeriesLive(
  series: { ended: boolean } | null | undefined,
): boolean {
  return !!series && !series.ended;
}

/**
 * How a copy of a repeating task says it repeats (#5119): the pattern
 * ("Every Monday"), and with `next`, the next copy's day ("Every Monday ·
 * next Nov 24"). `first` is the copy's own due, which a by-date monthly
 * rule's day falls back to. `null` for a task with no live series.
 */
export function taskSeriesLine(
  series: TaskSeriesLine | null | undefined,
  first: Date,
  options: { next?: boolean } = {},
): string | null {
  if (!series || !taskSeriesLive(series)) return null;
  const pattern = describeRepeatPattern(series.recurrence_rule, first);
  if (!pattern) return null;
  if (!options.next) return pattern;
  const tz = parseTaskRepeatRule(series.recurrence_rule)?.timeZone;
  return `${pattern} · next ${shortDay(series.next_due_date, first, tz ?? localTimeZone())}`;
}

/**
 * The scope prompt on a copy of a repeating task (#5119), worded as the event
 * editors' (`SERIES_SCOPE_COPY` in `event-edit.ts`), for both apps.
 */
export const TASK_SERIES_SCOPE_COPY = {
  thisTask: "This task only",
  allUpcoming: "All upcoming tasks",
  saveTitle: "This is a repeating task",
  saveMessage:
    "Save your changes to this task only, or to every upcoming task?",
  deleteTitle: "Delete a repeating task",
  deleteMessage:
    "Delete this task only, or stop it repeating? Tasks that are done or overdue stay.",
  /** A Repeat change from a copy that isn't the one still to come. */
  repeatFromNext:
    "Change how it repeats from its next task, the one still to come.",
  /** A Repeat change saved with other changes. */
  repeatAlone:
    "Save the repeat change on its own first, then make your other changes.",
} as const;

/**
 * An "All upcoming tasks" write (#5119), for both apps. The copy keeps its
 * day there, so only the time travels: the server reads the time of day
 * from `due_at` and refuses any `due_date` but the open copy's own.
 */
export function taskSeriesBody<T extends { due_date?: string }>(
  body: T,
): Omit<T, "due_date" | "scope"> & { scope: "series" } {
  const rest = { ...body, scope: "series" as const };
  delete rest.due_date;
  return rest;
}

/**
 * What saving an edit of a task does (#5119), decided before anything is
 * uploaded or written:
 *
 * - `instance` for a task that isn't a copy of a live series; for a copy
 *   that isn't the one still to come (overdue, or marked done), since "All
 *   upcoming tasks" changes the series and its next copy, not that one; and
 *   for a move to another day (one copy moves; the schedule stays).
 * - `series` for a Repeat change on the copy still to come, which is about
 *   the series. Only on its own: with other changes it is `refuse`d, so a
 *   rename never lands on every copy unasked.
 * - `ask` for anything else on the copy still to come.
 *
 * `movesDay` is the caller's: whether the due's day changed, both read in
 * the same zone (a time change read in another zone isn't a move).
 */
export function taskSaveScope(
  task: {
    /** The display status: `OVERDUE` once past due. */
    status: string;
    series?: { ended: boolean } | null;
  },
  edit: {
    /** Present when the Repeat changed; `null` stops it. */
    recurrence_rule?: string | null;
    movesDay: boolean;
    /** Whether anything besides the Repeat changed. */
    changesOther: boolean;
  },
):
  | { kind: "instance" | "series" | "ask" }
  | { kind: "refuse"; message: string } {
  const live = taskSeriesLive(task.series);
  const upcoming = task.status !== "OVERDUE" && task.status !== "COMPLETED";
  if (edit.recurrence_rule !== undefined && live) {
    if (!upcoming) {
      return { kind: "refuse", message: TASK_SERIES_SCOPE_COPY.repeatFromNext };
    }
    if (edit.movesDay || edit.changesOther) {
      return { kind: "refuse", message: TASK_SERIES_SCOPE_COPY.repeatAlone };
    }
    return { kind: "series" };
  }
  if (!live || !upcoming || edit.movesDay) return { kind: "instance" };
  return { kind: "ask" };
}

/**
 * What saving one field's change of a task does (#5119), for the editors
 * that save a field at a time (web's task panel, the phone's task screen):
 * `taskSaveScope` over the field's body. Reference photos never ask, since a
 * series doesn't copy them and they go on the copy they were added to
 * (`spec/behavior/tasks.md` § Repeating tasks); a body with only photos is
 * `instance`. `movesDay` is the caller's, as for `taskSaveScope`.
 */
export function taskFieldSaveScope(
  task: Parameters<typeof taskSaveScope>[0],
  body: {
    recurrence_rule?: string | null;
    reference_photo_paths?: unknown;
    [field: string]: unknown;
  },
  movesDay: boolean,
): ReturnType<typeof taskSaveScope> {
  const { recurrence_rule, reference_photo_paths, ...rest } = body;
  if (!taskSeriesLive(task.series)) return { kind: "instance" };
  if (
    recurrence_rule === undefined &&
    reference_photo_paths !== undefined &&
    Object.keys(rest).length === 0
  ) {
    return { kind: "instance" };
  }
  return taskSaveScope(task, {
    ...(recurrence_rule !== undefined ? { recurrence_rule } : {}),
    movesDay,
    changesOther:
      Object.keys(rest).length > 0 || reference_photo_paths !== undefined,
  });
}
