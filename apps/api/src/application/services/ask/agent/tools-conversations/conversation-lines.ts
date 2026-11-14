import type { CatchUpMessage } from '#domain/utils/chat-catch-up';
import { parseLocalDate, zonedTimeToUtc } from '#domain/utils/zoned-time';
import {
  AGENT_RESULT_MAX_CHARS,
  AGENT_RESULT_MAX_SOURCES,
  type AgentEntity,
  type AgentSource,
  type AgentToolResult,
} from '../agent-tool';
import { nameInLine } from '../../ask-lines';

/**
 * What the conversation and record tools share (#4900): how a message
 * becomes a source, how the model's dates and ids are read, and the caps
 * every result is held to. `../agent-tool.ts` has the contract.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The most of one message a source carries. `oneLine` (`../../ask-lines.ts`)
 * cuts at 300, which fits a task title; an announcement or a plan typed into
 * a channel is longer, and a message cut there loses the part that was asked
 * about.
 */
export const MESSAGE_TEXT_MAX = 1000;

/** The most messages one read or search returns: one source each. */
export const MESSAGES_PER_RESULT = AGENT_RESULT_MAX_SOURCES;

/**
 * Text a member wrote, on one line and cut to `max`. A source that held a
 * line break could otherwise carry a second line that reads as someone
 * else's message, or as a field the tool wrote.
 */
export function flat(text: string | null | undefined, max: number): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  return `${line
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd()}...`;
}

/**
 * A member's or a channel's name inside a line the tool writes. Both are
 * typed by members, so the characters that end a name and start a fact are
 * taken out (`nameInLine`). What comes back is also the entity's name, so
 * the answer's `@Name` and `#channel` match it exactly.
 */
export function label(name: string | null | undefined, fallback: string) {
  return nameInLine(name) || fallback;
}

/** "Thursday, November 12, 2026 at 7:04 PM", in the asker's zone. */
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

/** "Thursday, November 12, 2026". A bare calendar day is that day everywhere. */
export function longDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: parseLocalDate(iso) ? 'UTC' : timeZone,
  }).format(new Date(iso));
}

/**
 * The record id in something the model passed: a bare id, or the id of a
 * source an earlier result carried (`message:<id>`, `meeting:<id>:summary`,
 * `document:<id>:<passage>`). Null when it is neither, so a malformed id is
 * an empty result and never reaches a `uuid` column.
 */
export function recordId(
  value: string,
  prefix: 'message' | 'meeting' | 'document',
): string | null {
  const text = value.trim();
  const id = text.startsWith(`${prefix}:`) ? (text.split(':')[1] ?? '') : text;
  return UUID.test(id) ? id.toLowerCase() : null;
}

export interface DateRange {
  /** Inclusive. Null: no lower bound. */
  from: Date | null;
  /** Exclusive. Null: no upper bound. */
  before: Date | null;
}

/**
 * `since` and `until` as the model writes them. A calendar day
 * (`2026-11-01`) is that whole day where the asker is, so `until` runs to
 * the end of it; an ISO time is that moment. An empty string is no bound.
 * Null when either cannot be read, or the two are the wrong way round.
 */
const EXACT_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export function readDateRange(
  since: string,
  until: string,
  timeZone: string,
): DateRange | null {
  const read = (value: string, endOfDay: boolean): Date | null | 'bad' => {
    const text = value.trim();
    if (!text) return null;
    if (parseLocalDate(text)) {
      const start = zonedTimeToUtc(text, '00:00', timeZone);
      if (!start) return 'bad';
      if (!endOfDay) return start;
      // The next day's start, found from noon so a clock change cannot skip it.
      const next = new Date(start.getTime() + 36 * 60 * 60 * 1000);
      const nextDay = new Intl.DateTimeFormat('en-CA', { timeZone }).format(
        next,
      );
      return zonedTimeToUtc(nextDay, '00:00', timeZone) ?? 'bad';
    }
    // Anything else must be an exact instant with its own offset, the form
    // a message's time has in a note ("2026-11-07T18:00:00.000Z"). A day
    // that does not exist ("2026-02-30"), a time with no offset and loose
    // words ("Nov 7") are refused: `Date.parse` would read each of them as
    // some date, in the server's zone, and the search would quietly run
    // over the wrong days.
    if (!EXACT_INSTANT.test(text)) return 'bad';
    const at = Date.parse(text);
    return Number.isNaN(at) ? 'bad' : new Date(at);
  };
  const from = read(since, false);
  const before = read(until, true);
  if (from === 'bad' || before === 'bad') return null;
  if (from && before && from.getTime() >= before.getTime()) return null;
  return { from, before };
}

/** The note for dates {@link readDateRange} could not read. */
export const BAD_DATES_NOTE =
  'The dates could not be read. Write each as a day like 2026-11-01, with since before until.';

/**
 * A range held to `maxDays`, ending at `before` (or now). With no `from`,
 * it starts `defaultDays` before that end. `clamped` says a longer range was shortened.
 */
export function boundedRange(
  range: DateRange,
  now: Date,
  defaultDays: number,
  maxDays: number,
): { from: Date; before: Date; clamped: boolean } {
  const before = range.before ?? new Date(now.getTime() + DAY_MS);
  const floor = new Date(before.getTime() - maxDays * DAY_MS);
  // With only an end given, the default start is counted back from that
  // end, not from now: "up to last December" is the months before it.
  const anchor = range.before ? before : now;
  const wanted =
    range.from ?? new Date(anchor.getTime() - defaultDays * DAY_MS);
  const clamped = wanted.getTime() < floor.getTime();
  return { from: clamped ? floor : wanted, before, clamped };
}

/** A result with nothing in it but a line saying why. */
export function nothing(chapterId: string, note: string): AgentToolResult {
  return { chapterId, sources: [], entities: [], note, leftOutMessages: 0 };
}

/**
 * `sources` held to the two caps every result keeps
 * (`AGENT_RESULT_MAX_SOURCES`, `AGENT_RESULT_MAX_CHARS`), in the order given.
 *
 * - `keep` says which end survives a cut: `'first'` (the default) keeps
 *   from the start, `'last'` from the end, for a stretch whose newest
 *   messages are the ones asked for.
 * - A source that crosses the character cap is cut to what is left when
 *   that still says something, and dropped otherwise. With `whole`, it is
 *   always dropped: a message is short, and half of one reads as all of it.
 *
 * `dropped` counts sources left off, `shortened` says one was cut short,
 * and `cut` is true for either, so the tool can say so in its note.
 */
export function fitSources(
  sources: readonly AgentSource[],
  options: { keep?: 'first' | 'last'; whole?: boolean } = {},
): {
  sources: AgentSource[];
  dropped: number;
  shortened: boolean;
  cut: boolean;
} {
  const last = options.keep === 'last';
  const ordered = last ? [...sources].reverse() : sources;
  const kept: AgentSource[] = [];
  let room = AGENT_RESULT_MAX_CHARS;
  let shortened = false;
  for (const source of ordered) {
    if (kept.length >= AGENT_RESULT_MAX_SOURCES) break;
    if (source.text.length <= room) {
      kept.push(source);
      room -= source.text.length;
      continue;
    }
    // A few words of a long section are not worth a source of their own.
    if (!options.whole && room >= 400) {
      shortened = true;
      kept.push({
        ...source,
        text: source.text
          .slice(0, room)
          .replace(/[\uD800-\uDBFF]$/, '')
          .trimEnd(),
      });
    }
    break;
  }
  const dropped = sources.length - kept.length;
  return {
    sources: last ? kept.reverse() : kept,
    dropped,
    shortened,
    cut: shortened || dropped > 0,
  };
}

/** Entities with one entry per member or channel. */
export function distinctEntities(entities: readonly AgentEntity[]) {
  const seen = new Map<string, AgentEntity>();
  for (const entity of entities) {
    seen.set(`${entity.type}:${entity.id}`, entity);
  }
  return [...seen.values()];
}

/**
 * One channel message as a source: one message, one source, one line.
 *
 * The line is the tool's words up to the colon (who, where, when) and the
 * member's words after it, flattened, so nothing a member types can start a
 * second line or pass for the part before the colon. The author and the
 * channel are also in `entities`, by the names the line uses.
 */
export function messageSource(
  message: CatchUpMessage,
  channel: { id: string; name: string },
  timeZone: string,
): { source: AgentSource; entities: AgentEntity[] } {
  const author = label(message.senderName, 'A member');
  const channelName = label(channel.name, 'channel');
  const where = `${author} in #${channelName} on ${longDateTime(message.createdAt, timeZone)}`;
  const how = [
    message.threadRootId ? 'replying in a thread' : null,
    message.mentionsReader ? 'mentioning you' : null,
  ].filter(Boolean);
  return {
    source: {
      id: `message:${message.id}`,
      kind: 'chat',
      title: `#${channelName}`,
      detail: author,
      date: message.createdAt,
      target: {
        type: 'message',
        channel_id: channel.id,
        message_id: message.id,
      },
      text: `${[where, ...how].join(', ')}: ${flat(message.content, MESSAGE_TEXT_MAX)}`,
      chat: true,
      authorIds: [message.senderId],
    },
    entities: [
      { type: 'member', id: message.senderId, name: author },
      { type: 'channel', id: channel.id, name: channelName },
    ],
  };
}

/** Message sources and their entities for a run of one channel's messages. */
export function messageSources(
  messages: readonly CatchUpMessage[],
  channel: { id: string; name: string },
  timeZone: string,
): { sources: AgentSource[]; entities: AgentEntity[] } {
  const built = messages.map((message) =>
    messageSource(message, channel, timeZone),
  );
  return {
    sources: built.map((entry) => entry.source),
    entities: built.flatMap((entry) => entry.entities),
  };
}

/** What a result says when the chapter keeps chat away from AI. */
export const CHAT_OFF_NOTE =
  'This chapter has channel messages turned off for Frapp AI, so no messages can be read.';
