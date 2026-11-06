import {
  RECURRENCE_REPEAT_LABELS,
  attendanceToWire,
  describeAttendance,
  emptyAttendanceDraft,
  recurrenceLastStart,
  recurrenceMeetingCount,
  type EventAttendanceDraft,
  type RecurrenceRule,
} from "@repo/validation";
import { parsePointReward } from "@/lib/tasks/create-task";

/**
 * Draft state and validation for the "New event" sheet
 * (`components/events/new-event-sheet.tsx`).
 *
 * The sheet opens simple: a name, when it starts and ends, and a place. The
 * rest sits behind "More options" (Paul, 2026-11-06: "nobody wants a billion
 * options showing up when they open create event"): who's coming by role,
 * repeat, points and a description. The check-in zone stays on the web
 * editor, where a map belongs.
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
/**
 * The iOS time wheel's minute step: every minute, as Calendar allows. A
 * 5-minute step couldn't set a 6:48 start (Paul, 2026-11-06).
 */
export const MINUTE_INTERVAL = 1;

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
  /** Who's coming, by role (`spec/behavior/events.md` § Attendance by role). */
  attendance: EventAttendanceDraft;
  /** `null` for a one-time event. */
  recurrenceRule: RecurrenceRule | null;
  description: string;
  /** Whether "More options" is open: kept with the draft, so a reopen keeps it. */
  showMore: boolean;
}

/** A fresh draft. */
export function emptyEventDraft(): NewEventDraft {
  return {
    name: "",
    start: null,
    end: null,
    location: "",
    pointsInput: DEFAULT_POINTS,
    // Optional for everyone, as `/event` creates it: a required event marks
    // everyone who misses it absent, so it is a choice, not a default.
    attendance: emptyAttendanceDraft(),
    recurrenceRule: null,
    description: "",
    showMore: false,
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
  description?: string;
  point_value: number;
  is_mandatory: boolean;
  others_invited: boolean;
  required_role_ids?: string[];
  optional_role_ids?: string[];
  excluded_role_ids?: string[];
  recurrence_rule?: RecurrenceRule;
}

export interface NewEventErrors {
  name?: string;
  start?: string;
  end?: string;
  points?: string;
  attendance?: string;
}

/**
 * The draft as a request body, or the reasons it isn't one.
 *
 * Mirrors `CreateEventDto` (a name, ISO start and end with the end after the
 * start, an integer point value in `0 … POINTS_ADJUSTMENT_MAX`) and adds two
 * rules of the phone's own: an event has to invite someone, and the start can't have passed. An event created
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

  const wire = attendanceToWire(draft.attendance);
  if (
    !wire.others_invited &&
    wire.required_role_ids.length === 0 &&
    wire.optional_role_ids.length === 0
  ) {
    errors.attendance = "Nobody is invited. Add a role, or invite everyone.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const location = draft.location.trim();
  const description = draft.description.trim();
  const body: ValidatedNewEvent = {
    name,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    point_value: points.kind === "value" ? points.points : 0,
    is_mandatory: wire.is_mandatory,
    // Always sent: omitted beside `required_role_ids`, the API would read the
    // older "only these roles" meaning (`othersInvitedOf`).
    others_invited: wire.others_invited,
  };
  if (location.length > 0) body.location = location;
  if (description.length > 0) body.description = description;
  if (wire.required_role_ids.length > 0) {
    body.required_role_ids = wire.required_role_ids;
  }
  if (wire.optional_role_ids.length > 0) {
    body.optional_role_ids = wire.optional_role_ids;
  }
  if (wire.excluded_role_ids.length > 0) {
    body.excluded_role_ids = wire.excluded_role_ids;
  }
  if (draft.recurrenceRule) body.recurrence_rule = draft.recurrenceRule;
  return { ok: true, body };
}

/**
 * The line under the Repeat choices: how long the series runs, since it isn't
 * open-ended ("13 meetings, the last on Feb 5"). `null` for a one-time event.
 */
export function repeatCaption(
  start: Date,
  rule: RecurrenceRule | null,
): string | null {
  if (!rule) return null;
  const count = recurrenceMeetingCount(rule);
  const last = recurrenceLastStart(start, rule);
  if (count === null || last === null) return null;
  const day = last.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(last.getFullYear() !== start.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${count} meetings, the last on ${day}.`;
}

/**
 * What "More options" holds, said in one line while it is closed, so the
 * officer can see what the event will do without opening it:
 * "10 pts · Optional for everyone · Doesn't repeat".
 */
export function moreOptionsSummary(
  draft: Pick<NewEventDraft, "pointsInput" | "attendance" | "recurrenceRule">,
  roleName: (roleId: string) => string | undefined,
): string {
  const points = parsePointReward(draft.pointsInput);
  const pointsText =
    points.kind === "value"
      ? `${points.points} pts`
      : points.kind === "omit"
        ? "0 pts"
        : "Points need a fix";
  const repeat = draft.recurrenceRule
    ? RECURRENCE_REPEAT_LABELS[draft.recurrenceRule]
    : "Doesn't repeat";
  return [
    pointsText,
    describeAttendance(draft.attendance, roleName),
    repeat,
  ].join(" · ");
}
