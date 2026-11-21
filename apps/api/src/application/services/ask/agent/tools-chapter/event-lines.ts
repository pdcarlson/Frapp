import { NotFoundException } from '@nestjs/common';
import type { Event } from '#domain/entities/event.entity';
import type { EventAttendanceStatus } from '#domain/entities/event-attendance.entity';
import { localDateIn } from '#domain/utils/zoned-time';
import type { EventService } from '../../../event.service';
import type { AgentToolContext } from '../agent-tool';
import {
  DAY_MS,
  longRange,
  matchByName,
  quoted,
  readWindow,
} from './chapter-tool-kit';

/** How the event tools find one event and write it (#4901). */

/** How far either side of now an event is looked for by name. */
const FIND_DAYS = 200;

const EVENT_ID =
  /^(?:event:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface FoundEvent {
  event: Event | null;
  /** How many events fit what was asked; more than one means it was ambiguous. */
  candidates: number;
}

/**
 * The one event the model meant by a name, a day, or both.
 *
 * Every candidate comes from the asker's own calendar (`GET /v1/events`, or
 * `GET /v1/events/:id` for an id), so an event of another chapter, or one
 * whose roles leave the asker out, is simply not found. When several fit,
 * the nearest to now is taken (`prefer` says on which side) and the caller
 * tells the model there were others.
 */
export async function findEvent(
  events: Pick<EventService, 'findByChapter' | 'findById'>,
  args: { event: string; on: string },
  context: AgentToolContext,
  prefer: 'upcoming' | 'past',
): Promise<FoundEvent> {
  const byId = EVENT_ID.exec(args.event);
  if (byId) {
    try {
      const event = await events.findById(
        byId[1],
        context.chapterId,
        context.userId,
      );
      return { event, candidates: 1 };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { event: null, candidates: 0 };
      }
      throw error;
    }
  }
  if (!args.event && !args.on) return { event: null, candidates: 0 };

  const window = args.on
    ? readWindow({ from: args.on, to: args.on }, context, {
        backDays: 0,
        aheadDays: 0,
        maxDays: 1,
      })
    : {
        start: new Date(context.now.getTime() - FIND_DAYS * DAY_MS),
        end: new Date(context.now.getTime() + FIND_DAYS * DAY_MS),
      };
  const calendar = await events.findByChapter(
    context.chapterId,
    context.userId,
    {
      endsAfter: window.start.toISOString(),
      startsBefore: window.end.toISOString(),
    },
  );
  let fits = args.event
    ? matchByName(calendar, (event) => event.name, args.event)
    : calendar;
  if (args.on) {
    // The window catches an event that only runs into the day (it started
    // the night before); one that starts on the day is the better reading.
    const starting = fits.filter(
      (event) =>
        localDateIn(new Date(event.start_time), context.timeZone) === args.on,
    );
    if (starting.length > 0) fits = starting;
  }
  if (fits.length === 0) return { event: null, candidates: 0 };

  const now = context.now.getTime();
  const start = (event: Event) => Date.parse(event.start_time);
  const ahead = fits
    .filter((event) => Date.parse(event.end_time) >= now)
    .sort((a, b) => start(a) - start(b));
  const behind = fits
    .filter((event) => Date.parse(event.end_time) < now)
    .sort((a, b) => start(b) - start(a));
  const [first, second] =
    prefer === 'upcoming' ? [ahead, behind] : [behind, ahead];
  return { event: first[0] ?? second[0], candidates: fits.length };
}

/** The note for a result that took one of several events. */
export function ambiguityNote(found: FoundEvent): string | null {
  return found.candidates > 1
    ? `${found.candidates} events fit that. This is the nearest one; give the day in "on" to pick another.`
    : null;
}

/**
 * `"Chapter meeting" (already happened): Sunday, November 15, 2026 at 7:00
 * PM to 8:00 PM, at "the chapter room"`. The place is as an officer typed
 * it. The check-in zone and its coordinates are never read: no location
 * reaches a model.
 */
export function eventHeadline(event: Event, context: AgentToolContext): string {
  const over = Date.parse(event.end_time) < context.now.getTime();
  return `${quoted(event.name)}${over ? ' (already happened)' : ''}: ${longRange(event.start_time, event.end_time, context.timeZone)}${event.location ? `, at ${quoted(event.location)}` : ''}`;
}

export const ATTENDANCE_WORDS: Record<EventAttendanceStatus, string> = {
  PRESENT: 'present',
  LATE: 'late',
  ABSENT: 'absent',
  EXCUSED: 'excused',
};
