import { localIsoDate, parseInstant } from "@repo/formatting";
import type { CalendarBirthday } from "@repo/hooks/calendar-birthdays";
import type {
  CalendarItem,
  CalendarKind,
  CalendarTask,
} from "@repo/hooks/calendar-tasks";
import type { EventListEntry } from "@repo/hooks/event-series";

/**
 * The Events agenda (#5560): one list of days, each day's events, tasks and
 * birthdays together, in place of the List and the Calendar. Pure, so the
 * page draws what this decides and the rules are tested here.
 */

/** One row of a day, by kind. */
export type AgendaRow<E> =
  | { kind: "events"; key: string; entry: EventListEntry<E> }
  | { kind: "tasks"; key: string; task: CalendarTask }
  | { kind: "birthdays"; key: string; birthday: CalendarBirthday };

export interface AgendaDay<E> {
  /** `YYYY-MM-DD`, or {@link UNDATED_KEY} for events whose start can't be read. */
  key: string;
  /** Local midnight; `null` for the undated group. */
  date: Date | null;
  rows: AgendaRow<E>[];
}

export type AgendaBlock<E> =
  | { type: "day"; day: AgendaDay<E> }
  /** One line, "Nothing this week.", where seven days hold nothing. */
  | { type: "quiet-week" };

export interface Agenda<E> {
  blocks: AgendaBlock<E>[];
  /** What the shown range holds of each kind, hidden kinds included. */
  counts: Record<CalendarKind, number>;
  /** Days with rows after the shown range: what "Show more" reaches. */
  hasMore: boolean;
  /** Days shown with at least one row. */
  dayKeys: ReadonlySet<string>;
}

export const UNDATED_KEY = "undated";

/** How many days the agenda reaches before "Show more". */
export const AGENDA_SPAN_DAYS = 28;

/** The days "Nothing this week." speaks for. */
const QUIET_WEEK_DAYS = 7;

export function addDays(day: Date, count: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + count);
}

export function dateOfKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export interface AgendaInput<E> {
  /**
   * The events to list, already narrowed by the filters and with each
   * repeating series collapsed to one row, in the order a day lists them.
   */
  entries: readonly EventListEntry<E>[];
  /** Tasks and birthdays, in the order a day lists each kind. */
  items: readonly CalendarItem[];
  startOf: (event: E) => unknown;
  keyOf: (event: E) => string;
  /** Local midnight of the day the agenda starts on. */
  anchor: Date;
  /** Forward from the anchor (Upcoming, All), or back from it (Past). */
  direction: 1 | -1;
  spanDays: number;
  /** All: events before the anchor are listed too, oldest first. */
  eventsBeforeAnchor?: boolean;
  /** Kinds the colour key has switched off. */
  hidden: ReadonlySet<CalendarKind>;
}

type Bucket<E> = Record<CalendarKind, AgendaRow<E>[]>;

function emptyBucket<E>(): Bucket<E> {
  return { events: [], tasks: [], birthdays: [] };
}

export function buildAgenda<E>(input: AgendaInput<E>): Agenda<E> {
  const { anchor, direction, hidden } = input;
  const anchorKey = localIsoDate(anchor);
  const endKey = localIsoDate(addDays(anchor, direction * input.spanDays));

  const byDay = new Map<string, Bucket<E>>();
  const bucketOf = (key: string) => {
    let bucket = byDay.get(key);
    if (!bucket) {
      bucket = emptyBucket<E>();
      byDay.set(key, bucket);
    }
    return bucket;
  };
  for (const entry of input.entries) {
    const start = parseInstant(input.startOf(entry.event));
    const key = start ? localIsoDate(start) : UNDATED_KEY;
    bucketOf(key).events.push({
      kind: "events",
      key: `event:${input.keyOf(entry.event)}`,
      entry,
    });
  }
  for (const item of input.items) {
    if (item.kind === "birthdays") {
      bucketOf(item.day).birthdays.push({
        kind: "birthdays",
        key: item.key,
        birthday: item,
      });
    } else {
      bucketOf(item.day).tasks.push({
        kind: "tasks",
        key: item.key,
        task: item,
      });
    }
  }

  // A day's rows: events by start, then tasks, then birthdays, less what the
  // key switched off.
  const visibleRows = (bucket: Bucket<E>): AgendaRow<E>[] =>
    (["events", "tasks", "birthdays"] as const).flatMap((kind) =>
      hidden.has(kind) ? [] : bucket[kind],
    );

  const inWindow = (key: string, bucket: Bucket<E>) => {
    if (direction === 1) {
      if (key >= endKey) return false;
      if (key >= anchorKey) return true;
      // Before the anchor: All's earlier events only.
      return Boolean(input.eventsBeforeAnchor) && bucket.events.length > 0;
    }
    return key <= anchorKey && key > endKey;
  };
  const dated = [...byDay.keys()]
    .filter((key) => key !== UNDATED_KEY)
    .sort((a, b) =>
      direction === 1 ? a.localeCompare(b) : b.localeCompare(a),
    );
  const withRows = dated.filter(
    (key) => visibleRows(byDay.get(key)!).length > 0,
  );

  let shown = withRows.filter((key) => inWindow(key, byDay.get(key)!));
  let beyond = withRows.filter((key) =>
    direction === 1 ? key >= endKey : key <= endKey,
  );
  // Nothing in the whole window: carry on to the next day that has anything,
  // rather than end the list on empty days.
  if (direction === 1 && shown.every((key) => key < anchorKey) && beyond[0]) {
    shown = [...shown, beyond[0]];
    beyond = beyond.slice(1);
  }

  const blocks: AgendaBlock<E>[] = [];
  const dayBlock = (key: string): AgendaBlock<E> => ({
    type: "day",
    day: {
      key,
      date: dateOfKey(key),
      rows: visibleRows(byDay.get(key) ?? emptyBucket<E>()),
    },
  });

  if (direction === 1) {
    for (const key of shown) {
      if (key < anchorKey) blocks.push(dayBlock(key));
    }
    // The anchor always shows: today reads "Nothing today." when empty, and
    // a day picked on the navigator reads "Nothing on …".
    blocks.push(dayBlock(anchorKey));
    const weekEnd = localIsoDate(addDays(anchor, QUIET_WEEK_DAYS));
    const quietWeek = !shown.some((key) => key >= anchorKey && key < weekEnd);
    const after = shown.filter((key) => key > anchorKey);
    if (quietWeek) blocks.push({ type: "quiet-week" });
    for (const key of after) blocks.push(dayBlock(key));
    const undated = byDay.get(UNDATED_KEY);
    if (undated && visibleRows(undated).length > 0) {
      blocks.push(dayBlock(UNDATED_KEY));
    }
  } else {
    for (const key of shown) blocks.push(dayBlock(key));
  }

  // Counts cover the range on screen, whatever the key hides, so a kind
  // switched off still says how many it is holding back.
  const counts: Record<CalendarKind, number> = {
    events: 0,
    tasks: 0,
    birthdays: 0,
  };
  const last = shown[shown.length - 1];
  const inRange = (key: string) => {
    if (direction === -1) return key <= anchorKey && key > endKey;
    if (key < anchorKey && !input.eventsBeforeAnchor) return false;
    return key < endKey || (last !== undefined && key <= last);
  };
  for (const key of dated) {
    if (!inRange(key)) continue;
    const bucket = byDay.get(key)!;
    counts.events += bucket.events.length;
    counts.tasks += bucket.tasks.length;
    counts.birthdays += bucket.birthdays.length;
  }
  if (direction === 1) {
    counts.events += byDay.get(UNDATED_KEY)?.events.length ?? 0;
  }

  return {
    blocks,
    counts,
    hasMore: beyond.length > 0,
    dayKeys: new Set(
      blocks.flatMap((block) =>
        block.type === "day" && block.day.rows.length > 0
          ? [block.day.key]
          : [],
      ),
    ),
  };
}

/** Which kinds have anything on each day, for the navigator's dots. */
export function kindsByDay<E>(
  events: readonly E[],
  startOf: (event: E) => unknown,
  items: readonly CalendarItem[],
  hidden: ReadonlySet<CalendarKind>,
): Map<string, Set<CalendarKind>> {
  const map = new Map<string, Set<CalendarKind>>();
  const add = (key: string, kind: CalendarKind) => {
    if (hidden.has(kind)) return;
    const kinds = map.get(key);
    if (kinds) kinds.add(kind);
    else map.set(key, new Set([kind]));
  };
  for (const event of events) {
    const start = parseInstant(startOf(event));
    if (start) add(localIsoDate(start), "events");
  }
  for (const item of items) {
    add(item.day, item.kind === "birthdays" ? "birthdays" : "tasks");
  }
  return map;
}
