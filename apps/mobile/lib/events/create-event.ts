import {
  DEFAULT_CHECK_IN_OPENS_MINUTES,
  MAX_CHECK_IN_OPENS_MINUTES,
  attendanceInvitesNobody,
  attendanceToWire,
  othersInvitedForCreate,
  describeAttendance,
  emptyAttendanceDraft,
  eventRequiresAnyone,
  noRepeatDraft,
  repeatRuleOf,
  repeatSummary,
  withEveryone,
  type EventAttendanceDraft,
  type RepeatDraft,
  type RepeatEditSeries,
} from "@repo/validation";
import { parsePointReward } from "@/lib/tasks/create-task";

/**
 * Draft state and validation for the "New event" sheet
 * (`components/events/new-event-sheet.tsx`).
 *
 * The sheet opens simple: a name, when it starts and ends, and a place. The
 * rest sits behind "More options" (Paul, 2026-11-06: "nobody wants a billion
 * options showing up when they open create event"): who's coming by role,
 * points, how early check-in opens, repeat and a description. The check-in zone stays on the web
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
  /**
   * The chapter's event type the event is made as (#3730), or `null`.
   * Picking one only fills in the fields below ({@link applyEventType}).
   */
  eventTypeId: string | null;
  /**
   * The name the last picked type wrote into `name`, so picking a different
   * type replaces it but never a name the officer typed.
   */
  typeFilledName: string | null;
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
  /**
   * How many minutes before the start check-in opens, as keypad text
   * (`check_in_opens_minutes`; #3703). Blank reads as the default.
   */
  checkInOpensInput: string;
  /** Who's coming, by role (`spec/behavior/events.md` § Attendance by role). */
  attendance: EventAttendanceDraft;
  /**
   * The Repeat control (`@repo/validation` `repeat-draft.ts`): a preset, its
   * options and how the series ends.
   */
  repeat: RepeatDraft;
  description: string;
  /** Whether "More options" is open: kept with the draft, so a reopen keeps it. */
  showMore: boolean;
}

/** A fresh draft. */
export function emptyEventDraft(): NewEventDraft {
  return {
    eventTypeId: null,
    typeFilledName: null,
    name: "",
    start: null,
    end: null,
    location: "",
    pointsInput: DEFAULT_POINTS,
    checkInOpensInput: String(DEFAULT_CHECK_IN_OPENS_MINUTES),
    // Optional for everyone, as `/event` creates it: a required event marks
    // everyone who misses it absent, so it is a choice, not a default.
    attendance: emptyAttendanceDraft(),
    repeat: noRepeatDraft(),
    description: "",
    showMore: false,
  };
}

/** What a type carries into the form (`EventTypeDto`). */
export interface EventTypeChoice {
  id: string;
  name: string;
  point_value: number;
  is_mandatory: boolean;
}

/**
 * The draft after a type chip is tapped (`spec/behavior/events.md` § Event
 * types). Tapping the held type lets it go and changes nothing else. Picking
 * one sets its points, whether everyone must attend (roles already set apart
 * stay set apart, and a draft that invites only some roles keeps doing so),
 * and its name when the name is blank or still the last pick's.
 *
 * For a member who can't make anyone required or attach points
 * (`setsRequirements` false, #3709), the type only names the event: its
 * points and its required default are left out.
 */
export function applyEventType(
  draft: NewEventDraft,
  type: EventTypeChoice,
  setsRequirements = true,
): Partial<NewEventDraft> {
  if (draft.eventTypeId === type.id) return { eventTypeId: null };
  const patch: Partial<NewEventDraft> = setsRequirements
    ? {
        eventTypeId: type.id,
        pointsInput: String(type.point_value),
        attendance:
          draft.attendance.everyone === "not_invited"
            ? draft.attendance
            : withEveryone(
                draft.attendance,
                type.is_mandatory ? "required" : "optional",
              ),
      }
    : { eventTypeId: type.id };
  if (draft.name.trim() === "" || draft.name === draft.typeFilledName) {
    patch.name = type.name;
    patch.typeFilledName = type.name;
  }
  return patch;
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
  others_invited?: boolean;
  required_role_ids?: string[];
  optional_role_ids?: string[];
  excluded_role_ids?: string[];
  recurrence_rule?: string;
  check_in_opens_minutes?: number;
  event_type_id?: string;
}

export interface NewEventErrors {
  name?: string;
  start?: string;
  end?: string;
  points?: string;
  checkInOpens?: string;
  attendance?: string;
  /** Under the Repeat options: why the series can't be saved as set. */
  repeat?: string;
}

/**
 * The "Check-in opens" field as minutes, or `null` when it isn't a whole
 * number in `0 … MAX_CHECK_IN_OPENS_MINUTES` (the `CreateEventDto` bound).
 * Blank is the default, as a blank points field is 0.
 */
export function parseCheckInOpens(input: string): number | null {
  const text = input.trim();
  if (text.length === 0) return DEFAULT_CHECK_IN_OPENS_MINUTES;
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  return minutes <= MAX_CHECK_IN_OPENS_MINUTES ? minutes : null;
}

/** The error under the field when {@link parseCheckInOpens} refuses it. */
export const CHECK_IN_OPENS_ERROR = `Check-in can open up to ${MAX_CHECK_IN_OPENS_MINUTES} minutes before the start.`;

/**
 * The draft as a request body, or the reasons it isn't one.
 *
 * Mirrors `CreateEventDto` (a name, ISO start and end with the end after the
 * start, an integer point value in `0 … POINTS_ADJUSTMENT_MAX`) and adds two
 * rules of the phone's own: an event has to invite someone, and the start can't have passed. An event created
 * after it ended would vanish from the Events list on save, and a mandatory
 * one would have the auto-absent sweep mark the whole chapter absent. A blank
 * points field sends 0, as the web editor does.
 *
 * `setsRequirements` is whether the maker holds `events:update` (#3709). A
 * member without it makes an event worth no points (its points field is
 * hidden and ignored) and can't make anyone required, which the API holds them
 * to as well (`EventService.create` stores such an event as optional).
 */
export function validateNewEvent(
  draft: NewEventDraft,
  now: Date,
  setsRequirements = true,
):
  | { ok: true; body: ValidatedNewEvent }
  | { ok: false; errors: NewEventErrors } {
  const errors: NewEventErrors = {};
  const name = draft.name.trim();
  if (name.length === 0) errors.name = "Give the event a name.";

  const { start, end } = resolveEventTimes(draft, now);
  if (start < now) errors.start = "That start time has already passed.";
  if (end <= start) errors.end = "The event has to end after it starts.";

  const points = setsRequirements
    ? parsePointReward(draft.pointsInput)
    : ({ kind: "omit" } as const);
  if (points.kind === "invalid") {
    errors.points = "Points must be a whole number, up to 100,000.";
  }
  const opens = parseCheckInOpens(draft.checkInOpensInput);
  if (opens === null) errors.checkInOpens = CHECK_IN_OPENS_ERROR;

  const wire = attendanceToWire(draft.attendance);
  if (attendanceInvitesNobody(wire)) {
    errors.attendance = "Nobody is invited. Add a role, or invite everyone.";
  } else if (!setsRequirements && eventRequiresAnyone(wire)) {
    errors.attendance =
      "Only officers who manage events can make one required. Set it to optional.";
  }

  const repeat = repeatRuleOf(draft.repeat, start);
  if (!repeat.ok) errors.repeat = repeat.error;

  if (Object.keys(errors).length > 0 || opens === null) {
    return { ok: false, errors };
  }

  const location = draft.location.trim();
  const description = draft.description.trim();
  const body: ValidatedNewEvent = {
    name,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    point_value: points.kind === "value" ? points.points : 0,
    is_mandatory: wire.is_mandatory,
  };
  // Sent only when a row without it would read differently, so a plain event
  // still creates against an API that predates the field.
  const othersInvited = othersInvitedForCreate(wire);
  if (othersInvited !== undefined) body.others_invited = othersInvited;
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
  if (repeat.ok && repeat.rule) body.recurrence_rule = repeat.rule;
  // Sent only when one is picked, so a plain event still creates against an
  // API that predates types.
  if (draft.eventTypeId) body.event_type_id = draft.eventTypeId;
  // Sent only when it isn't the default the server applies, so an ordinary
  // event still creates against an API that predates the field.
  if (opens !== DEFAULT_CHECK_IN_OPENS_MINUTES) {
    body.check_in_opens_minutes = opens;
  }
  return { ok: true, body };
}

/**
 * What "More options" holds, said in one line while it is closed, so the
 * officer can see what the event will do without opening it:
 * "10 pts · Optional for everyone · Doesn't repeat". A check-in lead other
 * than the default joins it ("Check-in opens 30 min early"); the default goes
 * unsaid, as it does on every event.
 */
export function moreOptionsSummary(
  draft: Pick<
    NewEventDraft,
    "pointsInput" | "attendance" | "repeat" | "checkInOpensInput"
  >,
  roleName: (roleId: string) => string | undefined,
  start: Date,
  /** False hides points, for a member who can't attach them (#3709). */
  setsRequirements = true,
  /** On an edit, the series a Repeat change applies to. */
  series?: RepeatEditSeries,
): string {
  const points = parsePointReward(draft.pointsInput);
  const pointsText = !setsRequirements
    ? null
    : points.kind === "value"
      ? `${points.points} pts`
      : points.kind === "omit"
        ? "0 pts"
        : "Points need a fix";
  const repeat = repeatSummary(draft.repeat, start, series);
  const opens = parseCheckInOpens(draft.checkInOpensInput);
  const opensText =
    opens === null
      ? "Check-in time needs a fix"
      : opens === DEFAULT_CHECK_IN_OPENS_MINUTES
        ? null
        : opens === 0
          ? "Check-in opens at the start"
          : `Check-in opens ${opens} min early`;
  return [
    pointsText,
    describeAttendance(draft.attendance, roleName),
    opensText,
    repeat,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}
