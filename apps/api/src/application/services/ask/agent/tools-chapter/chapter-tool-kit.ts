import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AskSourceKind, AskSourcePage } from '@repo/validation';
import { WILDCARD } from '#domain/constants/permissions';
import {
  localDateIn,
  parseLocalDate,
  zonedTimeToUtc,
} from '#domain/utils/zoned-time';
import { nameInLine, oneLine } from '../../ask-lines';
import {
  AGENT_RESULT_MAX_CHARS,
  type AgentEntity,
  type AgentSource,
  type AgentSourceAudience,
  type AgentToolContext,
  type AgentToolResult,
} from '../agent-tool';

/**
 * What the chapter tools share (#4901): how a date, a total and a name are
 * written, how a list is cut to the size one result may be, and how a name
 * the model typed is matched to a member. `../agent-tool.ts` has the rules a
 * tool keeps; nothing here reads anything.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The text one of these tools writes at most. Under the loop's own cut
 * (`AGENT_RESULT_MAX_CHARS`), so a tool always gets to say what it left out
 * instead of being cut mid-line.
 */
export const TEXT_BUDGET = AGENT_RESULT_MAX_CHARS - 1_000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "Sunday, November 15, 2026 at 7:00 PM", in the asker's zone. Never abbreviated. */
export function longDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/** "7:00 PM", in the asker's zone. */
export function clockTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/**
 * "Sunday, November 15, 2026 at 7:00 PM to 8:00 PM": the day is said once
 * when both ends fall on the same day in the asker's zone.
 */
export function longRange(
  start: string,
  end: string,
  timeZone: string,
): string {
  const day = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
  return day(start) === day(end)
    ? `${longDateTime(start, timeZone)} to ${clockTime(end, timeZone)}`
    : `${longDateTime(start, timeZone)} to ${longDateTime(end, timeZone)}`;
}

/**
 * "Saturday, November 14, 2026". A calendar date with no time (a task's due
 * day, a service entry's date) is that day everywhere, so it is not moved
 * into the asker's zone.
 */
export function longDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: DATE_ONLY.test(iso) ? 'UTC' : timeZone,
  }).format(new Date(iso));
}

/** The first line of a result whose facts are days and times. */
export function todayLine(context: AgentToolContext): string {
  return `Today is ${longDay(context.now.toISOString(), context.timeZone)}. Times are in ${context.timeZone}.`;
}

/** "1 task", "3 tasks". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "83%", worked out here so a model never divides. Null when there is nothing to divide by. */
export function percent(part: number, whole: number): string | null {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : null;
}

/** "2 hours 30 minutes", "45 minutes", "3 hours". */
export function duration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return count(rest, 'minute');
  return rest === 0
    ? count(hours, 'hour')
    : `${count(hours, 'hour')} ${count(rest, 'minute')}`;
}

/**
 * Text a member wrote (a task's title, an event's name, a reason), on one
 * line and inside quotation marks, with its own quotation marks made single.
 * Where the quotation closes is where the member's words end, so a title
 * like `Cups: assigned to Dana. Past due` cannot pass for the facts that
 * follow it on the line.
 */
export function quoted(text: string | null | undefined): string {
  return `"${oneLine(text).replace(/["\u201c\u201d]/g, "'")}"`;
}

/** Whether the asker holds `permission`, as `PermissionsGuard` would decide. */
export function holds(context: AgentToolContext, permission: string): boolean {
  return (
    context.permissions.has(WILDCARD) || context.permissions.has(permission)
  );
}

/**
 * A day the model may give, as `YYYY-MM-DD`, or empty for the tool's own
 * default. Anything else fails the schema, so a tool never guesses at
 * "next week".
 */
export function dayArg(description: string) {
  return z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use YYYY-MM-DD, or leave it empty.')
    .default('')
    .describe(description);
}

/** A few words the model may give: a name, or words to look for. */
export function wordsArg(description: string, max = 80) {
  return z.string().trim().max(max).default('').describe(description);
}

/** The instant local day `date` starts in `timeZone`, or null for no day. */
function dayStart(date: string, timeZone: string): Date | null {
  return parseLocalDate(date) ? zonedTimeToUtc(date, '00:00', timeZone) : null;
}

/** The most a clock change adds to a local day. */
const CLOCK_CHANGE_MS = 60 * 60 * 1000;

/** Midnight after the local day that starts at `day`, clock changes included. */
function nextDayStart(day: Date, timeZone: string): Date {
  // Noon the next day by the clock is always inside the next local day.
  const inNextDay = new Date(day.getTime() + DAY_MS + 12 * 60 * 60 * 1000);
  return (
    dayStart(localDateIn(inNextDay, timeZone), timeZone) ??
    new Date(day.getTime() + DAY_MS)
  );
}

/**
 * Sunday at midnight where the asker is: the week the Activity page counts
 * (`localWeekStart` in `packages/hooks/src/activity-standing.ts`). Without
 * it the standing read counts the UTC week, which starts hours early or late
 * for the member.
 */
export function localWeekStart(context: AgentToolContext): Date {
  const today = localDateIn(context.now, context.timeZone);
  const [year, month, day] = today.split('-').map(Number);
  // The weekday of a calendar day is the same wherever it is read.
  const sunday = new Date(Date.UTC(year, month - 1, day));
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  return (
    dayStart(sunday.toISOString().slice(0, 10), context.timeZone) ?? context.now
  );
}

export interface ReadWindow {
  start: Date;
  end: Date;
  /** True when the range asked for was longer than the tool reads. */
  shortened: boolean;
}

/**
 * The stretch of time a tool reads: the days the model gave, read in the
 * asker's zone, or the tool's own default around now. Never longer than
 * `maxDays`, whatever was asked for, so an argument cannot turn one read
 * into the chapter's whole history.
 */
export function readWindow(
  args: { from: string; to: string },
  context: AgentToolContext,
  defaults: { backDays: number; aheadDays: number; maxDays: number },
): ReadWindow {
  let from = dayStart(args.from, context.timeZone);
  let lastDay = dayStart(args.to, context.timeZone);
  // The two days the wrong way round still name the same stretch.
  if (from && lastDay && lastDay < from) [from, lastDay] = [lastDay, from];
  // `to` names a whole day, so the window runs to the start of the next one.
  const to = lastDay ? nextDayStart(lastDay, context.timeZone) : null;
  const now = context.now.getTime();
  let start = from ?? new Date(now - defaults.backDays * DAY_MS);
  let end = to ?? new Date(now + defaults.aheadDays * DAY_MS);
  // One end given and the default for the other lands on the wrong side of
  // it: read on from (or back from) the day that was named.
  if (from && !to && end <= start) {
    end = new Date(start.getTime() + defaults.maxDays * DAY_MS);
  }
  if (to && !from && start >= end) {
    start = new Date(end.getTime() - defaults.maxDays * DAY_MS);
  }
  const longest = defaults.maxDays * DAY_MS;
  // A day the clocks go back is 25 hours long, and it is still one day.
  const shortened = end.getTime() - start.getTime() > longest + CLOCK_CHANGE_MS;
  if (shortened) {
    // Keep the end the model named when it named only that one.
    if (to && !from) start = new Date(end.getTime() - longest);
    else end = new Date(start.getTime() + longest);
  }
  return { start, end, shortened };
}

/** "from Sunday, November 1, 2026 to Monday, November 30, 2026". */
export function windowWords(window: ReadWindow, timeZone: string): string {
  // The end is exclusive (the start of the day after), so the last day read
  // is the one a millisecond before it.
  const last = new Date(window.end.getTime() - 1).toISOString();
  return `from ${longDay(window.start.toISOString(), timeZone)} to ${longDay(last, timeZone)}`;
}

/**
 * As many of `rows` as fit under the summary lines, in order. A row is
 * never cut in the middle: a half line could read as a different fact.
 */
export function fitRows(
  summary: readonly string[],
  rows: readonly string[],
  limit: number,
  budget = TEXT_BUDGET,
): string[] {
  let used = summary.reduce((sum, line) => sum + line.length + 1, 0);
  const shown: string[] = [];
  for (const row of rows) {
    if (shown.length >= limit || used + row.length + 1 > budget) break;
    shown.push(row);
    used += row.length + 1;
  }
  return shown;
}

/**
 * Lower case, accents and punctuation off, spaces collapsed: how two
 * spellings of a name compare ("Sgt. at Arms" and "sgt at arms").
 */
export function plainName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The items whose name the model most plausibly meant by `query`: the ones
 * that are exactly it, else the ones that contain it, else the ones that
 * contain every word of it in any order. Several come back when the name is
 * ambiguous; the tool says so and never picks one itself.
 */
export function matchByName<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  query: string,
): T[] {
  const wanted = plainName(query);
  if (!wanted) return [];
  const named = items.map((item) => ({ item, name: plainName(nameOf(item)) }));
  const exact = named.filter(({ name }) => name === wanted);
  if (exact.length > 0) return exact.map(({ item }) => item);
  const within = named.filter(({ name }) => name.includes(wanted));
  if (within.length > 0) return within.map(({ item }) => item);
  const words = wanted.split(' ');
  return named
    .filter(({ name }) => words.every((word) => name.includes(word)))
    .map(({ item }) => item);
}

/**
 * The members a typed name could be, strongest reading first, the way Act
 * reads a name an officer typed (`membersNamed` in `../../act/act-people.ts`):
 * the whole name; then every typed word being one of the member's words (a
 * first name, a last name, both in either order); then every typed word
 * starting one ("Jor" for Jordan); then, as the directory's search box does,
 * the typed letters anywhere in the name. Only the name is matched, never an
 * email or a profile field, so a lookup cannot confirm a contact detail.
 */
export function matchPerson<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  query: string,
): T[] {
  const wanted = plainName(query);
  if (!wanted) return [];
  const want = wanted.split(' ');
  const named = items.map((item) => {
    const name = plainName(nameOf(item));
    return { item, name, words: name.split(' ') };
  });
  const pick = (test: (entry: (typeof named)[number]) => boolean) =>
    named.filter(test).map(({ item }) => item);
  const exact = pick(({ name }) => name === wanted);
  if (exact.length > 0) return exact;
  const whole = pick(({ words }) => want.every((word) => words.includes(word)));
  if (whole.length > 0) return whole;
  if (want.every((word) => word.length >= 3)) {
    const starts = pick(({ words }) =>
      want.every((word) => words.some((have) => have.startsWith(word))),
    );
    if (starts.length > 0) return starts;
  }
  // Spaces off both, so "obrien" finds O'Brien and "maryann" Mary Ann.
  const run = wanted.replace(/ /g, '');
  if (run.length < 3) return [];
  return pick(({ name }) => name.replace(/ /g, '').includes(run));
}

/**
 * Whether `name` is in `text` as a whole name and not as the start of a
 * longer one: "Sam" is not named by a line about "Samuel".
 */
function namesWhole(text: string, name: string): boolean {
  const literal = name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`,
    'u',
  ).test(text);
}

/**
 * The members a result names. Each name is written the one way a `name:
 * fact` line can hold it (`nameInLine`), and every member whose name ends up
 * in the text is returned as an entity, so the answer can link `@Name`
 * without a model ever writing an id.
 */
export class People {
  readonly #names = new Map<string, string>();
  readonly #used = new Map<string, string>();

  constructor(
    roster: readonly { user_id: string; display_name: string | null }[],
  ) {
    for (const entry of roster) {
      this.#names.set(entry.user_id, nameInLine(entry.display_name));
    }
  }

  has(userId: string): boolean {
    return Boolean(this.#names.get(userId));
  }

  /** The member's name for a line; someone no longer on the roster has none. */
  name(userId: string | null | undefined): string {
    const name = userId ? this.#names.get(userId) : undefined;
    if (!userId || !name) return 'A former member';
    this.#used.set(userId, name);
    return name;
  }

  /**
   * The members named in `text`, which may have been cut since they were
   * written. Longer names are looked for first and taken out as they are
   * found, so "Sam Lee" in a line does not also name a member called "Sam".
   */
  entities(text: string): AgentEntity[] {
    let left = text;
    const found = new Set<string>();
    const longestFirst = [...new Set(this.#used.values())].sort(
      (a, b) => b.length - a.length,
    );
    for (const name of longestFirst) {
      if (!namesWhole(left, name)) continue;
      found.add(name);
      left = left.split(name).join('\n');
    }
    // In the order they were written; two members with one name are both
    // named by it.
    return [...this.#used]
      .filter(([, name]) => found.has(name))
      .map(([id, name]) => ({ type: 'member' as const, id, name }));
  }
}

const ARG_IN_ID_MAX = 40;

/**
 * A source id for a list with no single record behind it. The arguments are
 * part of it: two calls of one tool with different arguments in the same
 * turn read different things, and must not be taken for one source.
 */
export function listSourceId(
  tool: string,
  ...args: (string | number | null | undefined)[]
): string {
  const key = args
    .map((arg) => {
      const plain = plainName(String(arg ?? '')).replace(/ /g, '-');
      // A long argument keeps its start for reading and gains a digest of
      // the whole, so two that differ only late are still two sources.
      return plain.length <= ARG_IN_ID_MAX
        ? plain
        : `${plain.slice(0, ARG_IN_ID_MAX)}~${createHash('sha256').update(plain).digest('hex').slice(0, 8)}`;
    })
    .join(':')
    .replace(/:+$/, '');
  return key ? `tool:${tool}:${key}` : `tool:${tool}`;
}

/** One source of live data, read just now: a list, or one record. */
export function liveSource(source: {
  id: string;
  kind: AskSourceKind;
  title: string;
  detail?: string | null;
  /** ISO time of the one record this is, when it is one. */
  date?: string | null;
  page: AskSourcePage | null;
  lines: readonly string[];
  /** Who else could open it. Left out: only the asker. */
  audience?: AgentSourceAudience;
}): AgentSource {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    detail: source.detail ?? null,
    date: source.date ?? null,
    target: source.page ? { type: 'page', page: source.page } : null,
    text: source.lines.join('\n'),
    chat: false,
    authorIds: [],
    ...(source.audience ? { audience: source.audience } : {}),
  };
}

/** A result with something in it. `people` gives the entities its text names. */
export function found(
  context: AgentToolContext,
  source: AgentSource,
  people: People | null,
  note: string | null = null,
): AgentToolResult {
  return {
    chapterId: context.chapterId,
    sources: [source],
    entities: people ? people.entities(source.text) : [],
    note,
    leftOutMessages: 0,
  };
}

/** A result with nothing in it: no source, and the tool's own words for why. */
export function nothing(
  context: AgentToolContext,
  note: string,
): AgentToolResult {
  return {
    chapterId: context.chapterId,
    sources: [],
    entities: [],
    note,
    leftOutMessages: 0,
  };
}

/** `work` over `items`, a few at a time, in order. */
export async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const done: R[] = [];
  for (let at = 0; at < items.length; at += size) {
    done.push(...(await Promise.all(items.slice(at, at + size).map(work))));
  }
  return done;
}
