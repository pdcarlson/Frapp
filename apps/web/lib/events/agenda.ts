import {
  localIsoDate,
  parseBareDateLocalMidnight,
  parseInstant,
} from "@repo/formatting";
import type { CalendarBirthday } from "@repo/hooks/calendar-birthdays";
import {
  CALENDAR_KINDS,
  calendarKindOf,
  type CalendarItem,
  type CalendarKind,
  type CalendarTask,
} from "@repo/hooks/calendar-tasks";
import { addDays } from "@repo/hooks/calendar-time-grid";
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
  /** The viewer's unfinished tasks due before today, over Upcoming. */
  | { type: "overdue"; rows: AgendaRow<E>[] }
  | { type: "day"; day: AgendaDay<E> }
  /** One line, "Nothing this week.", where seven days hold nothing. */
  | { type: "quiet-week" };

export interface Agenda<E> {
  blocks: AgendaBlock<E>[];
  /**
   * What the shown range holds of each kind: the rows on screen, and the
   * rows a switched-off kind holds back on the same days.
   */
  counts: Record<CalendarKind, number>;
  /** Days with rows past the shown range: what "Show more" reaches. */
  hasMore: boolean;
  /** Days shown with at least one row. */
  dayKeys: ReadonlySet<string>;
}

export const UNDATED_KEY = "undated";

/** How many days the agenda reaches before "Show more". */
export const AGENDA_SPAN_DAYS = 28;

/** The days "Nothing this week." speaks for. */
const QUIET_WEEK_DAYS = 7;

/** The kinds in the order a day lists them, and the key draws them. */
const KIND_ORDER: readonly CalendarKind[] = CALENDAR_KINDS.map(
  (kind) => kind.value,
);

export function dateOfKey(key: string): Date | null {
  return parseBareDateLocalMidnight(key);
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
  /**
   * Whether the anchor's heading shows even with nothing on it: always
   * forward ("Nothing today."), and under Past once a day was picked.
   */
  forceAnchor: boolean;
  /** All: event days before the anchor are listed too, oldest first. */
  eventsBeforeAnchor?: boolean;
  /**
   * Upcoming: today's key. Unfinished tasks due before it, and before the
   * anchor, gather under one Overdue group at the top.
   */
  overdueBefore?: string;
  /** Kinds the colour key has switched off. */
  hidden: ReadonlySet<CalendarKind>;
}

type Bucket<E> = Record<CalendarKind, AgendaRow<E>[]>;

function emptyBucket<E>(): Bucket<E> {
  return { events: [], tasks: [], birthdays: [] };
}

function itemRow<E>(item: CalendarItem): AgendaRow<E> {
  return item.kind === "birthdays"
    ? { kind: "birthdays", key: item.key, birthday: item }
    : { kind: "tasks", key: item.key, task: item };
}

/** A task the viewer still has to do or chase: not done, not waiting. */
function isUnfinished(item: CalendarItem): boolean {
  return (
    item.kind !== "birthdays" &&
    item.state !== "waiting" &&
    item.state !== "confirmed"
  );
}

export function buildAgenda<E>(input: AgendaInput<E>): Agenda<E> {
  const { anchor, direction, hidden } = input;
  const forward = direction === 1;
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
  const overdue: AgendaRow<E>[] = [];
  for (const item of input.items) {
    if (
      input.overdueBefore &&
      item.day < input.overdueBefore &&
      item.day < anchorKey &&
      isUnfinished(item)
    ) {
      overdue.push(itemRow(item));
      continue;
    }
    bucketOf(item.day)[calendarKindOf(item)].push(itemRow(item));
  }

  // A day's rows: events by start, then tasks, then birthdays, less what the
  // key switched off.
  const visibleRows = (bucket: Bucket<E>): AgendaRow<E>[] =>
    KIND_ORDER.flatMap((kind) => (hidden.has(kind) ? [] : bucket[kind]));

  const inWindow = (key: string) => {
    if (!forward) return key <= anchorKey && key > endKey;
    if (key >= endKey) return false;
    if (key >= anchorKey) return true;
    // Before the anchor: All's earlier events only, as far as they show.
    const bucket = byDay.get(key)!;
    return (
      Boolean(input.eventsBeforeAnchor) &&
      !hidden.has("events") &&
      bucket.events.length > 0
    );
  };
  const dated = [...byDay.keys()]
    .filter((key) => key !== UNDATED_KEY)
    .sort((a, b) => (forward ? a.localeCompare(b) : b.localeCompare(a)));
  const withRows = dated.filter(
    (key) => visibleRows(byDay.get(key)!).length > 0,
  );
  const pastWindow = (key: string) => (forward ? key >= endKey : key <= endKey);

  let shown = withRows.filter(inWindow);
  let beyond = withRows.filter(pastWindow);
  // Nothing from the anchor on (or back, under Past) within the window:
  // carry on to the next day that has anything, rather than end the list on
  // empty days.
  const fromAnchor = (key: string) =>
    forward ? key >= anchorKey : key <= anchorKey;
  if (!shown.some(fromAnchor) && beyond[0]) {
    shown = [...shown, beyond[0]];
    beyond = beyond.slice(1);
  }

  const dayBlock = (key: string): AgendaBlock<E> => ({
    type: "day",
    day: {
      key,
      date: dateOfKey(key),
      rows: visibleRows(byDay.get(key) ?? emptyBucket<E>()),
    },
  });

  const blocks: AgendaBlock<E>[] = [];
  const shownOverdue = hidden.has("tasks") ? [] : overdue;
  if (shownOverdue.length > 0) {
    blocks.push({ type: "overdue", rows: shownOverdue });
  }
  // Days before the anchor in the reading order (All's earlier events).
  for (const key of shown) {
    if (!fromAnchor(key)) blocks.push(dayBlock(key));
  }
  // The anchor shows even when empty: "Nothing today.", "Nothing on …".
  const anchorShown = input.forceAnchor || shown.includes(anchorKey);
  if (anchorShown) blocks.push(dayBlock(anchorKey));
  if (forward) {
    const weekEnd = localIsoDate(addDays(anchor, QUIET_WEEK_DAYS));
    if (!shown.some((key) => key >= anchorKey && key < weekEnd)) {
      blocks.push({ type: "quiet-week" });
    }
  }
  for (const key of shown) {
    if (fromAnchor(key) && key !== anchorKey) blocks.push(dayBlock(key));
  }
  if (forward) {
    const undated = byDay.get(UNDATED_KEY);
    if (undated && visibleRows(undated).length > 0) {
      blocks.push(dayBlock(UNDATED_KEY));
    }
  }

  // Counts: every kind on the days the agenda shows, and on the empty-looking
  // days between them, so a kind switched off still says what it holds back.
  // A day before the anchor counts only when it is shown.
  const counts: Record<CalendarKind, number> = {
    events: 0,
    tasks: 0,
    birthdays: 0,
  };
  const lastShown = shown.filter(fromAnchor).at(-1);
  const inRange = (key: string) => {
    if (!fromAnchor(key)) return shown.includes(key);
    if (!pastWindow(key)) return true;
    return (
      lastShown !== undefined && (forward ? key <= lastShown : key >= lastShown)
    );
  };
  for (const key of dated) {
    if (!inRange(key)) continue;
    const bucket = byDay.get(key)!;
    for (const kind of KIND_ORDER) counts[kind] += bucket[kind].length;
  }
  counts.tasks += overdue.length;
  if (forward) counts.events += byDay.get(UNDATED_KEY)?.events.length ?? 0;

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
  for (const item of items) add(item.day, calendarKindOf(item));
  return map;
}
