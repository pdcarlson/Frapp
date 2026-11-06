import { parsePointReward } from "@/lib/tasks/create-task";

/**
 * Draft state and validation for the "New event" sheet
 * (`components/events/new-event-sheet.tsx`).
 *
 * The sheet is the phone's quick create, so it asks for what an officer needs
 * to put an event on the calendar: a name, when it starts and ends, a place,
 * points and the mandatory flag. Description, recurrence, role targeting and
 * the check-in zone stay on the web editor, as they do for the `/event` chat
 * command (`spec/behavior/events.md` § Chat Integration).
 *
 * `CreateEventDto` is the authority. These copies exist so the sheet can say
 * what is wrong before it posts a request it knows will 400, the relationship
 * `lib/tasks/create-task.ts` has to `CreateTaskDto`.
 *
 * Start and end are instants picked with the platform's own date and time
 * pickers (`@react-native-community/datetimepicker`), so an event that runs
 * past midnight simply ends on the next day.
 */

/** `@MaxLength(255)` on `CreateEventDto.name`. */
export const EVENT_NAME_MAX_LENGTH = 255;
/** The hour most chapter events start: 7:00 PM. */
export const DEFAULT_START_HOUR = 19;
/** A new event lasts an hour until the officer says otherwise. */
export const DEFAULT_LENGTH_MS = 60 * 60_000;
/** `spec/behavior/events.md`: "point value (configurable, default 10)". */
export const DEFAULT_POINTS = "10";
/** The iOS picker's minute step. */
export const MINUTE_INTERVAL = 5;

export interface NewEventDraft {
  name: string;
  /**
   * `null` until the officer picks a time: the sheet then reads the default
   * against the clock it is showing ({@link defaultEventStart}), so a sheet
   * mounted at 2 PM and opened at 9 PM doesn't offer a 7 PM already gone.
   */
  start: Date | null;
  /** `null` until picked: an hour after the start. */
  end: Date | null;
  location: string;
  /** Raw keypad text, so a half-typed value is not silently coerced. */
  pointsInput: string;
  isMandatory: boolean;
}

/** A fresh draft. */
export function emptyEventDraft(): NewEventDraft {
  return {
    name: "",
    start: null,
    end: null,
    location: "",
    pointsInput: DEFAULT_POINTS,
    isMandatory: false,
  };
}

/** 7:00 PM today, or tomorrow once today's has passed. */
export function defaultEventStart(now: Date): Date {
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    DEFAULT_START_HOUR,
  );
  if (today > now) return today;
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    DEFAULT_START_HOUR,
  );
}

/** The draft's start and end, defaults filled in against `now`. */
export function resolveEventTimes(
  draft: Pick<NewEventDraft, "start" | "end">,
  now: Date,
): { start: Date; end: Date } {
  const start = draft.start ?? defaultEventStart(now);
  const end = draft.end ?? new Date(start.getTime() + DEFAULT_LENGTH_MS);
  return { start, end };
}

/**
 * Where the end goes when the start moves: along with it, so the event keeps
 * its length, as Calendar does. A length that isn't positive (the officer set
 * the end before the start) resets to the default hour.
 */
export function shiftEnd(previous: { start: Date; end: Date }, next: Date) {
  const length = previous.end.getTime() - previous.start.getTime();
  return new Date(next.getTime() + (length > 0 ? length : DEFAULT_LENGTH_MS));
}

/**
 * A picked day joined to a held time of day, or a picked time joined to a
 * held day: Android's pickers set one at a time. Built from parts, so a
 * daylight-saving day keeps the wall-clock time picked.
 */
export function withDay(time: Date, day: Date): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    time.getHours(),
    time.getMinutes(),
  );
}

export interface ValidatedNewEvent {
  name: string;
  start_time: string;
  end_time: string;
  location?: string;
  point_value: number;
  is_mandatory: boolean;
}

export interface NewEventErrors {
  name?: string;
  start?: string;
  end?: string;
  points?: string;
}

/**
 * The draft as a request body, or the reasons it isn't one.
 *
 * Mirrors `CreateEventDto` (a name, ISO start and end with the end after the
 * start, an integer point value in `0 … POINTS_ADJUSTMENT_MAX`) and adds one
 * rule of the phone's own: the start can't have passed. An event created
 * after it ended would vanish from the Events list on save, and a mandatory
 * one would have the auto-absent sweep mark the whole chapter absent. A blank
 * points field sends 0, as the web editor does.
 */
export function validateNewEvent(
  draft: NewEventDraft,
  now: Date,
):
  | { ok: true; body: ValidatedNewEvent }
  | { ok: false; errors: NewEventErrors } {
  const errors: NewEventErrors = {};
  const name = draft.name.trim();
  if (name.length === 0) errors.name = "Give the event a name.";

  const { start, end } = resolveEventTimes(draft, now);
  if (start < now) errors.start = "That start time has already passed.";
  if (end <= start) errors.end = "The event has to end after it starts.";

  const points = parsePointReward(draft.pointsInput);
  if (points.kind === "invalid") {
    errors.points = "Points must be a whole number, up to 100,000.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const location = draft.location.trim();
  const body: ValidatedNewEvent = {
    name,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    point_value: points.kind === "value" ? points.points : 0,
    is_mandatory: draft.isMandatory,
  };
  if (location.length > 0) body.location = location;
  return { ok: true, body };
}
