import { localIsoDate, parseBareDateLocalNoon } from "@repo/formatting";
import { addDays, parsePointReward } from "@/lib/tasks/create-task";
import { TITLE_MAX_LENGTH } from "@/lib/tasks/limits";

/**
 * Draft state and validation for the "New event" sheet
 * (`components/events/new-event-sheet.tsx`).
 *
 * The sheet is the phone's quick create, so it asks for what an officer needs
 * to put an event on the calendar: a name, a day, a start and an end, a place,
 * points and the mandatory flag. Description, recurrence, role targeting and
 * the check-in zone stay on the web editor, as they do for the `/event` chat
 * command (`spec/behavior/events.md` § Chat Integration).
 *
 * `CreateEventDto` is the authority. These copies exist so the sheet can say
 * what is wrong before it posts a request it knows will 400, the relationship
 * `lib/tasks/create-task.ts` has to `CreateTaskDto`.
 *
 * ## Why the day and times are drawn in JS
 *
 * The app carries no native date or time picker, and adding one is a native
 * module, so it would wait for the next store build. The sheet draws its own:
 * a month grid for the day and an hour / minute / AM-PM grid for a time
 * (`components/events/event-when-pickers.tsx`). Both are taps on fixed
 * targets, with no wheel to fight the sheet's own drag. Times move in quarter
 * hours, which is how chapters schedule.
 */

/** Minutes after local midnight, `0 … 1439`. */
export type ClockMinutes = number;

export interface NewEventDraft {
  name: string;
  /** `YYYY-MM-DD`, device-local. */
  date: string;
  start: ClockMinutes;
  end: ClockMinutes;
  location: string;
  /** Raw keypad text, so a half-typed value is not silently coerced. */
  pointsInput: string;
  isMandatory: boolean;
}

/** 7:00 PM, the hour most chapter events start. */
export const DEFAULT_START: ClockMinutes = 19 * 60;
/** An hour after {@link DEFAULT_START}. */
export const DEFAULT_END: ClockMinutes = 20 * 60;
/** `spec/behavior/events.md`: "point value (configurable, default 10)". */
export const DEFAULT_POINTS = "10";
/** The time grid's steps. */
export const MINUTE_STEPS = [0, 15, 30, 45] as const;

/**
 * The day a new draft starts on: today, or tomorrow once today's default
 * start has passed, so the sheet never opens on a time already gone.
 */
export function defaultEventDate(now: Date): string {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return localIsoDate(minutesNow >= DEFAULT_START ? addDays(now, 1) : now);
}

/** A fresh draft, read against `now`. */
export function emptyEventDraft(now: Date): NewEventDraft {
  return {
    name: "",
    date: defaultEventDate(now),
    start: DEFAULT_START,
    end: DEFAULT_END,
    location: "",
    pointsInput: DEFAULT_POINTS,
    isMandatory: false,
  };
}

/**
 * A kept draft's day, read on the day `now` falls on: a day that has passed
 * falls back to {@link defaultEventDate}, since the calendar can't show it as
 * picked and an event is not created into the past from here.
 */
export function resolveEventDate(date: string, now: Date): string {
  // `YYYY-MM-DD` orders as a string.
  return date >= localIsoDate(now) ? date : defaultEventDate(now);
}

/**
 * An end before the start means the next morning: a 9:00 PM to 1:00 AM party
 * is one event, not an error. Equal times are the one end that can't be read
 * either way.
 */
export function endsNextDay(start: ClockMinutes, end: ClockMinutes): boolean {
  return end < start;
}

/**
 * Where the end goes when the start moves: along with it, so the event keeps
 * its length, as calendar apps do. Wraps past midnight.
 */
export function shiftEnd(
  previousStart: ClockMinutes,
  previousEnd: ClockMinutes,
  nextStart: ClockMinutes,
): ClockMinutes {
  const length = (previousEnd - previousStart + 1440) % 1440;
  return (nextStart + length) % 1440;
}

/** `"7:00 PM"`, in the device's locale. */
export function formatClock(minutes: ClockMinutes): string {
  const at = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `"Sat, Nov 8"`. */
export function formatEventDay(isoDate: string): string {
  const date = parseBareDateLocalNoon(isoDate);
  if (!date) return isoDate;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The clock split the way the time grid draws it. */
export function splitClock(minutes: ClockMinutes): {
  hour12: number;
  minute: number;
  pm: boolean;
} {
  const hour24 = Math.floor(minutes / 60);
  return {
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: minutes % 60,
    pm: hour24 >= 12,
  };
}

/** The inverse of {@link splitClock}. */
export function joinClock(hour12: number, minute: number, pm: boolean) {
  const hour24 = (hour12 % 12) + (pm ? 12 : 0);
  return hour24 * 60 + minute;
}

/** A local instant: `date` at `minutes`, `dayOffset` days on. */
function localInstant(date: string, minutes: ClockMinutes, dayOffset = 0) {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  // Built from parts, so a daylight-saving day lands on the wall-clock time
  // the officer picked rather than an hour off.
  return new Date(
    year,
    month - 1,
    day + dayOffset,
    Math.floor(minutes / 60),
    minutes % 60,
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
  time?: string;
  points?: string;
}

/**
 * The draft as a request body, or the reasons it isn't one.
 *
 * Mirrors `CreateEventDto`: a name of 1 … 255 characters, ISO start and end
 * with the end after the start, and an integer point value in
 * `0 … POINTS_ADJUSTMENT_MAX`. A blank points field sends 0, as the web
 * editor does.
 */
export function validateNewEvent(
  draft: NewEventDraft,
):
  | { ok: true; body: ValidatedNewEvent }
  | { ok: false; errors: NewEventErrors } {
  const errors: NewEventErrors = {};
  const name = draft.name.trim();
  if (name.length === 0) errors.name = "Give the event a name.";
  else if (name.length > TITLE_MAX_LENGTH)
    errors.name = `Keep the name under ${TITLE_MAX_LENGTH} characters.`;

  if (draft.start === draft.end) {
    errors.time = "The event has to end after it starts.";
  }

  const points = parsePointReward(draft.pointsInput);
  if (points.kind === "invalid") {
    errors.points = "Points must be a whole number, up to 100,000.";
  }

  if (errors.name || errors.time || errors.points) return { ok: false, errors };

  const start = localInstant(draft.date, draft.start);
  const end = localInstant(
    draft.date,
    draft.end,
    endsNextDay(draft.start, draft.end) ? 1 : 0,
  );
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

/**
 * One month as the calendar draws it: weeks of seven cells, Sunday first,
 * `null` for the blanks before the 1st and after the last day.
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from(
    { length: first.getDay() },
    () => null,
  );
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(localIsoDate(new Date(year, month, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}
