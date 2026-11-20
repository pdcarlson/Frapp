import type { MeetingSummary } from "@repo/hooks";
import {
  MINUTES_MANY,
  meetingTypeLabel,
  minutesTimeline,
  minutesWeekStart,
  type CalendarMeeting,
  type MeetingType,
  type MinutesTimelineGroup,
} from "@repo/validation";

/**
 * How the phone's Minutes list groups and finds minutes (#5290; Paul,
 * 2026-11-17: "it should probably have better grouping, you know, by like
 * type of event ... if it's a recurring event ... group it by recurring
 * event ... It just seems like a very dull interface").
 *
 * The list grows with the chapter, the way Granola's notes list does: a few
 * minutes sit in week groups at their dates, drafts and meetings that need
 * minutes among them, and nothing to filter; past
 * {@link MINUTES_MANY} it gains a search, type chips with their counts, a
 * Series section (a repeating event with two or more minutes folds into one
 * row, as Fireflies files recurring meetings into one channel) and month
 * groups (a series' minutes stay in their months too, as the design
 * page's long list draws them; the Series row is a way to browse). Pure
 * functions over the list read, so both shapes are tested
 * without a screen.
 */

export type MinutesListRow = MeetingSummary;
/** Past this many minutes the list gains search, type chips and Series. */
export { MINUTES_MANY };

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MinutesSeries {
  /** The series' first event's id (`series_key`). */
  key: string;
  /** The newest meeting's name: what the chapter calls it now. */
  name: string;
  type: MeetingType;
  rule: string | null;
  count: number;
  /** The newest meeting's start. */
  last: string;
  /** Every meeting's start, for the cadence's weekday. */
  starts: string[];
}

export type MinutesGroup = MinutesTimelineGroup<MinutesListRow>;

export interface MinutesListView {
  many: boolean;
  /** The types the minutes hold, with how many each, most first. */
  types: { type: MeetingType; count: number }[];
  series: MinutesSeries[];
  /**
   * One timeline (Paul, 2026-11-20; `minutesTimeline`): drafts, posted
   * minutes and the calendar's meetings with none, each at its date.
   */
  groups: MinutesGroup[];
  /** Whether a type or a search narrowed what is shown. */
  narrowed: boolean;
}

const startOf = (row: { event_start_time: string }) =>
  Date.parse(row.event_start_time);

/** The meetings of one series, newest first. */
export function seriesRows(
  rows: readonly MinutesListRow[],
  key: string,
): MinutesListRow[] {
  return rows
    .filter((row) => row.series_key === key)
    .sort((a, b) => startOf(b) - startOf(a));
}

/** Repeating events with two or more minutes, most recent meeting first. */
export function minutesSeries(
  rows: readonly MinutesListRow[],
): MinutesSeries[] {
  const keys = new Set(
    rows.flatMap((row) => (row.series_key ? [row.series_key] : [])),
  );
  return [...keys]
    .map((key) => seriesRows(rows, key))
    .filter((members) => members.length >= 2)
    .map((members) => ({
      key: members[0].series_key!,
      name: members[0].event_name,
      type: members[0].meeting_type as MeetingType,
      rule: members[0].series_rule,
      count: members.length,
      last: members[0].event_start_time,
      starts: members.map((row) => row.event_start_time),
    }))
    .sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
}

/** Whether a row matches what was typed: its name or its type. */
export function matchesQuery(row: MinutesListRow, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    row.event_name,
    meetingTypeLabel(row.meeting_type as MeetingType, row.other_label),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function minutesListView(
  rows: readonly MinutesListRow[],
  {
    now,
    type = null,
    query = "",
    write = [],
    skipped = [],
  }: {
    now: number;
    type?: MeetingType | null;
    query?: string;
    /** Meetings that ended with none; left out while the list is narrowed. */
    write?: readonly CalendarMeeting[];
    /** Meetings marked "No minutes"; left out while narrowed. */
    skipped?: readonly CalendarMeeting[];
  },
): MinutesListView {
  const newestFirst = [...rows].sort((a, b) => startOf(b) - startOf(a));
  const many = rows.length > MINUTES_MANY;
  const counts = new Map<MeetingType, number>();
  for (const row of rows) {
    const key = row.meeting_type as MeetingType;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const types = [...counts.entries()]
    .map(([key, count]) => ({ type: key, count }))
    .sort((a, b) => b.count - a.count);

  // Only the long list narrows: a short one has nothing to find.
  const typeOn = many ? type : null;
  const queryOn = many ? query.trim() : "";
  const narrowed = typeOn !== null || queryOn !== "";
  const shown = newestFirst.filter(
    (row) =>
      (typeOn === null || row.meeting_type === typeOn) &&
      matchesQuery(row, queryOn),
  );
  return {
    many,
    types,
    // Series are a way to browse; a search or a type shows the rows.
    series: many && !narrowed ? minutesSeries(newestFirst) : [],
    groups: minutesTimeline(shown, {
      write: narrowed ? [] : write,
      skipped: narrowed ? [] : skipped,
      now,
      many,
    }),
    narrowed,
  };
}

/**
 * The time on a row's right: the weekday and time for a meeting this
 * calendar week, else the date, with the year only when it isn't this one.
 */
export function minutesRowTime(start: string, now: number): string {
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return "";
  // A weekday names one day only inside this calendar week.
  const week = minutesWeekStart(now);
  if (at.getTime() >= week && at.getTime() < week + 7 * DAY_MS) {
    return at.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  return at.toLocaleDateString(
    "en-US",
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

/**
 * Whether a row says its type in words: the tile's hue says it too, but not
 * to everyone, and an Other meeting's own label only words can carry. Left
 * out where the list shows only that type, and where the title already says
 * it ("Exec Meeting" needn't add "Exec").
 */
export function showsTypeTag(
  row: Pick<MinutesListRow, "event_name" | "meeting_type" | "other_label">,
  narrowedTo: string | null,
): boolean {
  if (narrowedTo === row.meeting_type) return false;
  const label = meetingTypeLabel(
    row.meeting_type as MeetingType,
    row.other_label,
  ).toLowerCase();
  return !row.event_name.toLowerCase().includes(label);
}
