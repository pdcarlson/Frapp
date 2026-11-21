import { eventSeriesKey } from '@repo/validation';
import type { Event } from '../entities/event.entity';

/**
 * How far ahead the next meeting is looked for: a year, so one scheduled
 * after a summer or winter break still counts as on the calendar.
 */
export const NEXT_MEETING_LOOKAHEAD_DAYS = 400;

/** How long an item waits for its next meeting to be created (Shawn, 2026-11-20). */
export const NEXT_AGENDA_WAIT_DAYS = 30;

/**
 * Whether `candidate` is a later meeting of the same kind as `source` (#5790):
 * it invites the same people by the same rule, and is the same event type
 * when the source has one, else the same series or the same name (a new
 * term's series of "Chapter Meeting" is a new series with the same name). So an officers-only meeting's item never lands on a
 * meeting the whole chapter attends, and a chapter meeting's never on a
 * social that happens to invite everyone.
 */
export function isSameMeetingKind(
  source: Event,
  candidate: Event,
  audienceKey: (event: Event) => string,
): boolean {
  if (candidate.id === source.id) return false;
  if (audienceKey(candidate) !== audienceKey(source)) return false;
  if (source.event_type_id) {
    return candidate.event_type_id === source.event_type_id;
  }
  const series = eventSeriesKey(source);
  if (series && eventSeriesKey(candidate) === series) return true;
  return nameKey(candidate.name) === nameKey(source.name);
}

/**
 * The earliest of `events` that starts after `now` and is the same kind of
 * meeting as `source`, or null.
 */
export function nextMeetingOf(
  source: Event,
  events: readonly Event[],
  now: Date,
  audienceKey: (event: Event) => string,
): Event | null {
  const after = now.getTime();
  return (
    events
      .filter(
        (event) =>
          Date.parse(event.start_time) > after &&
          isSameMeetingKind(source, event, audienceKey),
      )
      .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))[0] ??
    null
  );
}

function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
