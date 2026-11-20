import type { CalendarMeeting } from "./minutes-to-write";

/**
 * The Meetings list as one timeline (Paul, 2026-11-20: "should this go in
 * chronological order?"), the same on web's Meetings page and the phone's
 * Minutes list.
 *
 * Every past meeting sits at its own date, newest first: posted minutes,
 * drafts (tagged Draft), a meeting on the calendar that ended with no
 * minutes (Write minutes), and one an officer marked "No minutes". The
 * meeting that's coming sits above them all, as Granola puts the calendar's
 * next meeting above its notes. A meeting missing minutes used to sit in a
 * section of its own on top, apart from the week it happened in, and drafts
 * had theirs; now a gap reads where it falls, the way a calendar shows it.
 *
 * Grouped by This week, Last week, then months; a long list (past
 * {@link MINUTES_MANY} minutes) groups by month alone.
 */

/** Past this many minutes the list groups by month (and the phone gains search). */
export const MINUTES_MANY = 8;

const DAY_MS = 86_400_000;

/** One row of the timeline. */
export type MinutesTimelineItem<M> =
  | { kind: "minutes"; key: string; start: string; minutes: M }
  /** Ended with no minutes: Write minutes, or mark it No minutes. */
  | { kind: "write"; key: string; start: string; event: CalendarMeeting }
  /** Marked "No minutes": settled. */
  | { kind: "skipped"; key: string; start: string; event: CalendarMeeting };

export interface MinutesTimelineGroup<M> {
  key: string;
  label: string;
  items: MinutesTimelineItem<M>[];
}

/** Midnight starting this calendar week (Sunday), on this device's clock. */
export function minutesWeekStart(now: number): number {
  const at = new Date(now);
  at.setHours(0, 0, 0, 0);
  at.setDate(at.getDate() - at.getDay());
  return at.getTime();
}

/** A month's group: "November", or "November 2025" in another year. */
export function minutesMonthGroup(
  start: string,
  now: number,
): { key: string; label: string } {
  const at = new Date(start);
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  return {
    key: `${at.getFullYear()}-${at.getMonth()}`,
    label: at.toLocaleDateString(
      "en-US",
      sameYear ? { month: "long" } : { month: "long", year: "numeric" },
    ),
  };
}

/** This week and last week by the calendar, then the month. */
export function minutesWeekGroup(
  start: string,
  now: number,
): { key: string; label: string } {
  const at = Date.parse(start);
  const week = minutesWeekStart(now);
  if (at >= week) return { key: "week", label: "This week" };
  if (at >= week - 7 * DAY_MS) return { key: "last", label: "Last week" };
  return minutesMonthGroup(start, now);
}

/**
 * Minutes and calendar meetings into one newest-first timeline, grouped.
 * `many` groups by month alone. A group keeps the order its rows come in.
 */
export function minutesTimeline<
  M extends { id: string; event_start_time: string },
>(
  minutes: readonly M[],
  {
    write = [],
    skipped = [],
    now,
    many = minutes.length > MINUTES_MANY,
  }: {
    write?: readonly CalendarMeeting[];
    skipped?: readonly CalendarMeeting[];
    now: number;
    many?: boolean;
  },
): MinutesTimelineGroup<M>[] {
  const items: MinutesTimelineItem<M>[] = [
    ...minutes.map((row): MinutesTimelineItem<M> => ({
      kind: "minutes",
      key: `minutes:${row.id}`,
      start: row.event_start_time,
      minutes: row,
    })),
    ...write.map((event): MinutesTimelineItem<M> => ({
      kind: "write",
      key: `event:${event.id}`,
      start: event.start_time,
      event,
    })),
    ...skipped.map((event): MinutesTimelineItem<M> => ({
      kind: "skipped",
      key: `event:${event.id}`,
      start: event.start_time,
      event,
    })),
  ].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));

  const groups = new Map<string, MinutesTimelineGroup<M>>();
  for (const item of items) {
    const { key, label } = many
      ? minutesMonthGroup(item.start, now)
      : minutesWeekGroup(item.start, now);
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
