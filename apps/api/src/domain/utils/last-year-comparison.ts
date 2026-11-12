import { createHash } from 'node:crypto';

/**
 * "This time last year" (#3930, `spec/behavior/ai.md` § This time last year):
 * what the chapter did around now a year ago that this year's calendar and
 * task board don't show.
 *
 * No model is called. The comparison is dates and titles, done here in code:
 *
 * - Whether something is on this year's record is a question about titles,
 *   and the cost of a wrong answer is lopsided. Staying quiet about a thing
 *   that is missing costs nothing the chapter had before; speaking up about
 *   a thing that is already planned under another name is the nagging the
 *   feature must never do. So the title match is loose on purpose (`Fall
 *   Formal 2025` is `Formal`, and `Philanthropy Week` is seen in a task
 *   called `Plan philanthropy week`): when in doubt, it has been seen.
 * - The line an officer reads is a fixed sentence around last year's own
 *   title and date, so there is nothing for a model to word, no member text
 *   to send to a provider, and no title that could be followed as an
 *   instruction.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A year, as 52 whole weeks: a Saturday formal last year lines up with a
 * Saturday this year, which a calendar year (365 or 366 days) does not.
 */
export const LAST_YEAR_SHIFT_DAYS = 364;
/** How far ahead it looks: the coming six weeks. */
export const LAST_YEAR_LOOKAHEAD_DAYS = 42;
/**
 * How far either side of that window this year's record is read when asking
 * "is it on this year's record": a thing held a month early, or planned for
 * a month later, has been seen.
 */
export const LAST_YEAR_SEEN_SLACK_DAYS = 60;
/** New suggestions one weekly sweep may make for a chapter. */
export const LAST_YEAR_MAX_NEW_PER_SWEEP = 3;
/** With this many still waiting, a sweep adds none. */
export const LAST_YEAR_MAX_WAITING = 5;
/**
 * A task title due in this many different months is a routine chore (clean
 * the kitchen), not something the chapter does once a year.
 */
export const LAST_YEAR_ROUTINE_TASK_MONTHS = 3;

export interface LastYearWindows {
  /** Last year's stretch: now to six weeks on, 52 weeks back. */
  lastYear: { from: Date; to: Date };
  /** This year's record that counts as "seen": the stretch plus the slack. */
  thisYear: { from: Date; to: Date };
}

export function lastYearWindows(now: Date): LastYearWindows {
  const at = now.getTime();
  return {
    lastYear: {
      from: new Date(at - LAST_YEAR_SHIFT_DAYS * DAY_MS),
      to: new Date(
        at - (LAST_YEAR_SHIFT_DAYS - LAST_YEAR_LOOKAHEAD_DAYS) * DAY_MS,
      ),
    },
    thisYear: {
      from: new Date(at - LAST_YEAR_SEEN_SLACK_DAYS * DAY_MS),
      to: new Date(
        at + (LAST_YEAR_LOOKAHEAD_DAYS + LAST_YEAR_SEEN_SLACK_DAYS) * DAY_MS,
      ),
    },
  };
}

/** `YYYY-MM-DD` moved by whole days. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// ------------------------------------------------------------------ titles

/** Words that say nothing about which thing a title names. */
const FILLER = new Set([
  'a',
  'an',
  'and',
  'annual',
  'at',
  'for',
  'in',
  'of',
  'on',
  'our',
  'the',
  'to',
  'with',
]);
/** Which term it was held in: the same thing next year carries another. */
const TERM = new Set([
  'autumn',
  'fall',
  'semester',
  'spring',
  'summer',
  'winter',
]);
const NUMBER = /^\d+(st|nd|rd|th)?$/;

function words(title: string): string[] {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      // "Brotherhood events" and "Brotherhood event" are one thing.
      word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
        ? word.slice(0, -1)
        : word,
    );
}

/**
 * What a title is compared by: its words, without years and counts ("2025",
 * "3rd"), filler, and the term it was held in. A title made only of those
 * ("Spring 2026") keeps its term words, and one with no words at all
 * compares with nothing.
 */
export function titleTokens(title: string): string[] {
  const all = words(title).filter(
    (word) => !NUMBER.test(word) && !FILLER.has(word),
  );
  const named = all.filter((word) => !TERM.has(word));
  return [...new Set(named.length > 0 ? named : all)].sort();
}

/** One thing's name across its spellings: its tokens, in order. */
export function titleKey(title: string): string {
  return titleTokens(title).join(' ');
}

/**
 * Whether two titles name the same thing, loosely: every word of the shorter
 * is in the longer, or they share most of their words.
 */
export function sameThing(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  const inLarge = new Set(large);
  const shared = small.filter((word) => inLarge.has(word)).length;
  if (shared === small.length) return true;
  return shared / (a.length + b.length - shared) >= 0.6;
}

/** Whether `title` names something this year's record already holds. */
export function seenThisYear(
  title: string,
  thisYear: readonly (readonly string[])[],
): boolean {
  const tokens = titleTokens(title);
  return thisYear.some((other) => sameThing(tokens, other));
}

// ------------------------------------------------------------------ things

export interface LastYearEventRecord {
  id: string;
  name: string;
  start_time: string;
}

export interface LastYearTaskRecord {
  id: string;
  title: string;
  description: string | null;
  /** `YYYY-MM-DD`. */
  due_date: string;
  /** Whether it was done: "y'all did this" is only true of a finished task. */
  completed: boolean;
  subtasks: readonly string[];
}

export type LastYearThing =
  | {
      type: 'event';
      /** Told apart by, once per year: never the title itself. */
      dedupeKey: string;
      /** The first of last year's occurrences in the stretch. */
      sourceId: string;
      name: string;
      /** When that first occurrence started. */
      lastYearAt: string;
      /** How many times it was held in the stretch (a weekly series: six). */
      times: number;
    }
  | {
      type: 'task';
      dedupeKey: string;
      sourceId: string;
      title: string;
      description: string | null;
      subtasks: readonly string[];
      /** The day last year's task was due. */
      lastYearOn: string;
    };

/**
 * Which thing, in which year, as a fingerprint: a suggestion keeps it after
 * it is decided (and keeps no words), so the same thing is never raised
 * twice in a year, whatever became of the first time.
 */
export function lastYearDedupeKey(
  type: 'event' | 'task',
  key: string,
  anniversary: Date,
): string {
  return createHash('sha256')
    .update(`last-year:v1:${type}:${key}:${anniversary.getUTCFullYear()}`)
    .digest('hex')
    .slice(0, 32);
}

export interface LastYearComparisonInput {
  now: Date;
  /** Last year's events, any order. Only those in last year's stretch count. */
  lastYearEvents: readonly LastYearEventRecord[];
  /**
   * The chapter's tasks, any order: last year's stretch is taken from them,
   * and the rest tell a routine chore from a yearly one.
   */
  tasks: readonly LastYearTaskRecord[];
  /** Titles on this year's record: events and tasks in this year's window. */
  thisYearTitles: readonly string[];
}

/**
 * Everything last year's stretch holds that this year's record doesn't, the
 * soonest anniversary first, events before tasks. The caller drops what was
 * already raised this year and keeps the first few.
 */
export function compareWithLastYear(
  input: LastYearComparisonInput,
): LastYearThing[] {
  const { lastYear } = lastYearWindows(input.now);
  const from = lastYear.from.getTime();
  const to = lastYear.to.getTime();
  const seen = input.thisYearTitles.map(titleTokens);
  const shift = LAST_YEAR_SHIFT_DAYS * DAY_MS;

  // Events: one thing per name, however many times it was held.
  const events = new Map<string, LastYearEventRecord[]>();
  for (const event of input.lastYearEvents) {
    const at = Date.parse(event.start_time);
    if (Number.isNaN(at) || at < from || at > to) continue;
    const key = titleKey(event.name);
    if (!key) continue;
    events.set(key, [...(events.get(key) ?? []), event]);
  }
  const eventThings: LastYearThing[] = [];
  for (const [key, held] of events) {
    held.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    const first = held[0];
    if (seenThisYear(first.name, seen)) continue;
    eventThings.push({
      type: 'event',
      dedupeKey: lastYearDedupeKey(
        'event',
        key,
        new Date(Date.parse(first.start_time) + shift),
      ),
      sourceId: first.id,
      name: first.name,
      lastYearAt: first.start_time,
      times: held.length,
    });
  }
  eventThings.sort((a, b) =>
    a.type === 'event' && b.type === 'event'
      ? Date.parse(a.lastYearAt) - Date.parse(b.lastYearAt)
      : 0,
  );

  // Tasks: finished ones due in the stretch, unless the title is a chore.
  const months = new Map<string, Set<string>>();
  for (const task of input.tasks) {
    const key = titleKey(task.title);
    if (!key) continue;
    const set = months.get(key) ?? new Set<string>();
    set.add(task.due_date.slice(0, 7));
    months.set(key, set);
  }
  const taskThings: LastYearThing[] = [];
  const taken = new Set<string>();
  const due = (task: LastYearTaskRecord) =>
    Date.parse(`${task.due_date}T12:00:00Z`);
  for (const task of [...input.tasks].sort((a, b) => due(a) - due(b))) {
    const at = due(task);
    if (Number.isNaN(at) || at < from || at > to || !task.completed) continue;
    const key = titleKey(task.title);
    if (!key || taken.has(key)) continue;
    if ((months.get(key)?.size ?? 0) >= LAST_YEAR_ROUTINE_TASK_MONTHS) continue;
    if (seenThisYear(task.title, seen)) continue;
    // A task for an event that is itself being raised says the same thing.
    if (
      eventThings.some(
        (thing) =>
          thing.type === 'event' &&
          sameThing(titleTokens(thing.name), titleTokens(task.title)),
      )
    ) {
      continue;
    }
    taken.add(key);
    taskThings.push({
      type: 'task',
      dedupeKey: lastYearDedupeKey('task', key, new Date(at + shift)),
      sourceId: task.id,
      title: task.title,
      description: task.description,
      subtasks: task.subtasks,
      lastYearOn: task.due_date,
    });
  }

  return [...eventThings, ...taskThings];
}
