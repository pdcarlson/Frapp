/**
 * The Events calendar's Week and Day views (#4818): where each timed event
 * sits in a day's column, the way Google Calendar, Apple Calendar and Outlook
 * draw it. A block starts at its start time and is as tall as it lasts;
 * events that overlap share the column side by side, each narrowed to its
 * lane. Pure, so web and the phone draw the same placement: both grids build
 * their columns with {@link timeGridColumns} and size them with the constants
 * below, so a placement rule lands on both at once (#4825).
 */

import { localIsoDate, parseInstant } from "@repo/formatting";

/** One hour row, as Google Calendar's default density. */
export const HOUR_HEIGHT = 48;

/** The grid's rows, midnight to 11 PM. */
export const GRID_HOURS: readonly number[] = Array.from(
  { length: 24 },
  (_, hour) => hour,
);

/**
 * Where the grid opens scrolled to: 8 AM, as Google Calendar and Outlook open
 * a work day. A chapter's evening meetings (the editor's default start is
 * 6 PM) are then on screen without scrolling at the grid's height.
 */
export const OPEN_AT_HOUR = 8;

/** Below this block height there's room for the name alone, not the time. */
export const TWO_LINE_MIN_HEIGHT = 36;

/** An hour row's label in the viewer's locale: "8 AM", or "08" on a 24-hour clock. */
export function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, {
    hour: "numeric",
  });
}

/** One event to place, in minutes from the day's local midnight. */
export type TimedSpan<T> = {
  item: T;
  /** Clipped to the day: 0 when it began the day before. */
  startMinute: number;
  /** Clipped to the day: 1440 when it runs past midnight. */
  endMinute: number;
};

export type PlacedSpan<T> = TimedSpan<T> & {
  /** Which lane of its overlap group, from 0 at the left. */
  lane: number;
  /** How many lanes its overlap group has; its width is `1 / lanes`. */
  lanes: number;
};

export const MINUTES_PER_DAY = 24 * 60;

/**
 * A block shorter than this is drawn this tall so its name can be read, and
 * overlaps are judged on the drawn height: a 10-minute event and one starting
 * 10 minutes after it would otherwise draw one on top of the other.
 */
export const MIN_BLOCK_MINUTES = 30;

/**
 * The part of an event inside the local day that starts at `dayStart`, in
 * minutes, or null when it doesn't touch that day. An event with no readable
 * end, or one that ends before it starts, is treated as an hour long, as the
 * editor's default length.
 */
export function spanWithinDay(
  start: Date,
  end: Date | null,
  dayStart: Date,
): { startMinute: number; endMinute: number } | null {
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const startMs = start.getTime();
  const rawEndMs = end?.getTime() ?? Number.NaN;
  const endMs =
    Number.isFinite(rawEndMs) && rawEndMs > startMs
      ? rawEndMs
      : startMs + 60 * 60 * 1000;
  if (endMs <= dayStart.getTime() || startMs >= dayEnd.getTime()) return null;
  // Measured in wall-clock minutes from this day's midnight, so a DST day
  // still draws 9 AM at the 9 AM row.
  const clampedStart = Math.max(startMs, dayStart.getTime());
  const clampedEnd = Math.min(endMs, dayEnd.getTime());
  const startMinute =
    clampedStart === dayStart.getTime()
      ? 0
      : minuteOfDay(new Date(clampedStart));
  const endMinute =
    clampedEnd === dayEnd.getTime()
      ? MINUTES_PER_DAY
      : minuteOfDay(new Date(clampedEnd));
  return { startMinute, endMinute: Math.max(endMinute, startMinute) };
}

export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Whether an event belongs in the all-day strip rather than the hour grid:
 * one that lasts a whole day or more, as a calendar app files a multi-day
 * event. Everything shorter is a block, clipped at midnight.
 */
export function isAllDaySpan(start: Date, end: Date | null): boolean {
  if (!end) return false;
  return end.getTime() - start.getTime() >= MINUTES_PER_DAY * 60 * 1000;
}

/**
 * Lanes for one day's timed events. Events are grouped into clusters that
 * overlap one another (directly or through a chain), and each cluster is laid
 * out in as few lanes as it needs: an event takes the leftmost lane that is
 * free when it starts. Every event in a cluster gets the cluster's lane count,
 * so the cluster's blocks are equal widths, as Google Calendar draws them.
 * Ordered by start, then the longer first, so a long event takes the left.
 */
export function layoutDay<T>(spans: readonly TimedSpan<T>[]): PlacedSpan<T>[] {
  const sorted = [...spans].sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      b.endMinute - b.startMinute - (a.endMinute - a.startMinute),
  );
  const placed: PlacedSpan<T>[] = [];
  let cluster: PlacedSpan<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const span of cluster) span.lanes = laneEnds.length;
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const span of sorted) {
    const drawnEnd = Math.max(
      span.endMinute,
      span.startMinute + MIN_BLOCK_MINUTES,
    );
    if (cluster.length > 0 && span.startMinute >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= span.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(drawnEnd);
    } else {
      laneEnds[lane] = drawnEnd;
    }
    cluster.push({ ...span, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, drawnEnd);
  }
  if (cluster.length > 0) closeCluster();
  return placed;
}

/** The days a Week or Day view shows, from `first`, each at local midnight. */
export function consecutiveDays(first: Date, count: number): Date[] {
  const days: Date[] = [];
  for (let index = 0; index < count; index += 1) {
    days.push(
      new Date(first.getFullYear(), first.getMonth(), first.getDate() + index),
    );
  }
  return days;
}

/** `date` at local midnight. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** What an event row needs for the grid to place it. */
type GridEvent = { start_time?: unknown; end_time?: unknown };

/** One day's column: its strip (all-day events and tasks) and its blocks. */
export type TimeGridColumn<E, Task> = {
  /** The day, at local midnight. */
  day: Date;
  /** `localIsoDate(day)`: the column's key, and `tasksByDay`'s. */
  key: string;
  /** Events lasting a whole day or more that touch this day, for the strip. */
  allDay: E[];
  tasks: Task[];
  /** The day's timed events, clipped to it and laid out in lanes. */
  placed: PlacedSpan<E>[];
};

/**
 * The Week or Day view's columns, one per day. Each event is placed on every
 * day it touches: one lasting a whole day or more sits in that day's strip, as
 * calendar apps draw a multi-day event, and a shorter one is a block clipped
 * to the day. An event whose start doesn't parse is left out.
 */
export function timeGridColumns<E extends GridEvent, Task>(
  days: readonly Date[],
  events: readonly E[],
  tasksByDay: ReadonlyMap<string, Task[]>,
): TimeGridColumn<E, Task>[] {
  const parsed = events.flatMap((event) => {
    const start = parseInstant(event.start_time);
    if (!start) return [];
    return [{ event, start, end: parseInstant(event.end_time) }];
  });
  return days.map((day) => {
    const key = localIsoDate(day);
    const allDay: E[] = [];
    const timed: TimedSpan<E>[] = [];
    for (const { event, start, end } of parsed) {
      const span = spanWithinDay(start, end, day);
      if (!span) continue;
      if (isAllDaySpan(start, end)) allDay.push(event);
      else timed.push({ item: event, ...span });
    }
    return {
      day,
      key,
      allDay,
      tasks: tasksByDay.get(key) ?? [],
      placed: layoutDay(timed),
    };
  });
}

/**
 * Where a placed block draws in its column, in the grid's units: its top at
 * its start, and as tall as it lasts but never shorter than
 * {@link MIN_BLOCK_MINUTES}, the height `layoutDay` judged its overlaps on.
 */
export function blockGeometry(span: {
  startMinute: number;
  endMinute: number;
}): { top: number; height: number } {
  const drawnMinutes = Math.max(
    span.endMinute - span.startMinute,
    MIN_BLOCK_MINUTES,
  );
  return {
    top: (span.startMinute / 60) * HOUR_HEIGHT,
    height: (drawnMinutes / 60) * HOUR_HEIGHT,
  };
}

/** Whether a block ends inside its day, so its end time can be shown. */
export function endsWithinDay(span: { endMinute: number }): boolean {
  return span.endMinute < MINUTES_PER_DAY;
}
