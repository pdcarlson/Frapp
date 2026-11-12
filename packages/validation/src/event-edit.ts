import {
  attendanceFromEvent,
  attendanceToWire,
  type EventAttendanceFields,
  type EventAttendanceWire,
} from "./event-attendance";
import { isRepeatRule } from "./recurrence";
import type { RepeatEditSeries } from "./repeat-draft";

/**
 * Editing or deleting an event that already exists, the same on web and the
 * phone (#3667): what a save sends, and whether to ask "this event or all
 * upcoming" first. Each app's form turns its own draft into
 * {@link EventEditValues}; everything after that is decided here.
 *
 * ## Only what changed is sent
 *
 * The server pushes "Event Updated" to the chapter whenever a patch carries a
 * time or a location, whether or not it differs. Round-tripping the whole
 * event would page everyone for a typo fix in the name. So the patch holds
 * only the fields the officer actually changed, and an untouched form saves
 * nothing.
 *
 * ## Repeating events
 *
 * A series is a parent row that carries the rule plus generated occurrences
 * that carry `parent_event_id` (`spec/behavior/events.md` § Recurrence edit
 * and cancellation scope). Saving an edit to one asks, as Google Calendar,
 * Apple Calendar and Outlook do, whether it is for this event or every
 * upcoming one. There is no "this and past": the server never rewrites a
 * meeting that already happened. A change to Repeat itself is a series
 * change, so it isn't asked.
 *
 * A series edit addressed to a generated occurrence drops its times, because
 * the server can't tell them from the occurrence's own. So a time change for
 * every upcoming event is sent to the series parent as the same *shift*: an
 * hour later on this occurrence is an hour later on the parent, and the
 * server moves the rest with it.
 */

export type EventEditScope = "instance" | "series";

/** What the series logic reads off a stored event. */
export interface SeriesEventFields {
  id: string;
  start_time: string;
  end_time: string;
  /** Set on a generated occurrence; `null` on a parent or a one-time event. */
  parent_event_id: string | null;
  /** The rule, on a series parent only. */
  recurrence_rule: string | null;
}

/** The event being edited, and what the form needs to know about its series. */
export interface EventEditTarget<
  E extends SeriesEventFields = SeriesEventFields,
> {
  event: E;
  /**
   * The series' rule: the event's own on a parent, the parent's on a
   * generated occurrence (whose own column is always empty). `null` for a
   * one-time event. A legacy token or a structured rule
   * (`spec/behavior/events.md` § Recurring events).
   */
  seriesRule: string | null;
  /**
   * The series parent, when the event is a generated occurrence and the
   * parent could be read. A series time change is sent to it.
   */
  parent: Pick<SeriesEventFields, "id" | "start_time" | "end_time"> | null;
}

/** The wording both apps ask with, so web and the phone read the same. */
export const SERIES_SCOPE_COPY = {
  thisEvent: "This event only",
  allUpcoming: "All upcoming events",
  saveTitle: "This is a repeating event",
  saveMessage:
    "Save your changes to this event only, or to every upcoming event in the series?",
  deleteTitle: "Delete a repeating event",
  deleteMessage:
    "Delete this event only, or every upcoming event in the series? Events that already happened stay.",
  /** A 400 on a series save: sending it again can't win. */
  seriesRefused:
    "That change can't be made to the whole series. Save it to this event only, or open the next event and change that.",
} as const;

/**
 * Whether the event belongs to a repeating series: any rule the API accepts,
 * a structured one included, so a rename on a structured series' head goes
 * series-wide.
 */
export function isInSeries(
  event: Pick<SeriesEventFields, "parent_event_id" | "recurrence_rule">,
): boolean {
  return !!event.parent_event_id || isRepeatRule(event.recurrence_rule);
}

/**
 * The series rule an edit form should show for this event: the parent's on a
 * generated occurrence, the event's own otherwise. Any rule the API accepts,
 * a legacy token or a structured one; anything else reads as none.
 */
export function seriesRuleOf(
  event: Pick<SeriesEventFields, "parent_event_id" | "recurrence_rule">,
  parent: { recurrence_rule?: unknown } | null,
): string | null {
  const rule = event.parent_event_id
    ? parent?.recurrence_rule
    : event.recurrence_rule;
  return isRepeatRule(rule) ? rule : null;
}

/** Whether the event has started: the server never edits it with the series. */
export function eventHasStarted(
  event: Pick<SeriesEventFields, "start_time">,
  now: Date,
): boolean {
  return new Date(event.start_time).getTime() <= now.getTime();
}

/**
 * Whether saving an edit may ask "this event or all upcoming".
 *
 * Not for a one-time event. Not for one already under way either: a series
 * edit only reaches events that haven't started, so "All upcoming" would skip
 * the very event on screen. And not for a generated occurrence whose parent
 * couldn't be read, since a series time change has to go through the parent.
 */
export function offersSeriesChoice(
  target: EventEditTarget,
  now: Date,
): boolean {
  if (!isInSeries(target.event) || eventHasStarted(target.event, now))
    return false;
  return !target.event.parent_event_id || target.parent !== null;
}

/**
 * Whether deleting may ask "this event or all upcoming". As for an edit, but
 * a delete needs no parent: a series delete addressed to any occurrence
 * reaches the whole series server-side, and carries no times to shift.
 */
export function deleteOffersSeriesChoice(
  event: Pick<
    SeriesEventFields,
    "parent_event_id" | "recurrence_rule" | "start_time"
  >,
  now: Date,
): boolean {
  return isInSeries(event) && !eventHasStarted(event, now);
}

/**
 * The series a Repeat change applies to. Its head is the parent on a
 * generated occurrence (when it could be read), else the event itself; a
 * series save shifts the head by the same as the edited meeting's start
 * (`saveRequestFor`).
 */
export function repeatEditSeriesOf(
  target: EventEditTarget,
  start: Date,
  now: Date,
): RepeatEditSeries {
  const { event, parent, seriesRule } = target;
  const head = event.parent_event_id && parent ? parent : event;
  return {
    headStart: new Date(head.start_time),
    headRule: seriesRule,
    shiftMs: start.getTime() - new Date(event.start_time).getTime(),
    now,
  };
}

export interface GeofencePoint {
  lat: number;
  lng: number;
}

/** The fields an edit may send. Absent means unchanged. */
export interface EventEditPatch {
  name?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
  notes?: string;
  point_value?: number;
  is_mandatory?: boolean;
  others_invited?: boolean;
  required_role_ids?: string[];
  optional_role_ids?: string[];
  excluded_role_ids?: string[];
  /** `null` ends the series. */
  recurrence_rule?: string | null;
  check_in_opens_minutes?: number;
  /** `null` clears the type. */
  event_type_id?: string | null;
  /** `[]` clears the zone. */
  check_in_zone?: GeofencePoint[];
  check_in_zone_name?: string;
}

/** The event as stored, for {@link eventEditPatch} to compare against. */
export interface EventEditStored {
  name: string;
  start_time: string;
  end_time: string;
  location: string | null;
  description: string | null;
  notes?: string | null;
  point_value: number | null;
  check_in_opens_minutes?: number | null;
  attendance: EventAttendanceFields;
  event_type_id: string | null;
  check_in_zone?: unknown;
  check_in_zone_name?: string | null;
}

/**
 * The form's values, already checked. A key a form leaves out is a field it
 * doesn't edit (the phone has no notes or zone fields; web has no check-in
 * window), and is never sent.
 */
export interface EventEditValues {
  name?: string;
  start?: Date;
  end?: Date;
  location?: string;
  description?: string;
  notes?: string;
  point_value?: number;
  check_in_opens_minutes?: number;
  attendance?: EventAttendanceWire;
  event_type_id?: string | null;
  /** The series rule the form now holds; compared with the target's. */
  recurrence_rule?: string | null;
  /** Finite points only; `[]` is no zone. */
  check_in_zone?: GeofencePoint[];
  check_in_zone_name?: string;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function sameWire(a: EventAttendanceWire, b: EventAttendanceWire): boolean {
  return (
    a.is_mandatory === b.is_mandatory &&
    a.others_invited === b.others_invited &&
    sameIds(a.required_role_ids, b.required_role_ids) &&
    sameIds(a.optional_role_ids, b.optional_role_ids) &&
    sameIds(a.excluded_role_ids, b.excluded_role_ids)
  );
}

function sameInstant(a: Date, iso: string): boolean {
  return a.getTime() === new Date(iso).getTime();
}

/** A stored zone's finite points, in order; anything malformed reads as none. */
function storedZone(value: unknown): GeofencePoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point: unknown) => {
    if (!point || typeof point !== "object") return [];
    const { lat, lng } = point as { lat?: unknown; lng?: unknown };
    return typeof lat === "number" &&
      Number.isFinite(lat) &&
      typeof lng === "number" &&
      Number.isFinite(lng)
      ? [{ lat, lng }]
      : [];
  });
}

function sameZone(a: GeofencePoint[], b: GeofencePoint[]): boolean {
  return (
    a.length === b.length &&
    a.every((point, i) => point.lat === b[i]?.lat && point.lng === b[i]?.lng)
  );
}

/** Whether the patch writes nothing. */
export function isEmptyEventPatch(patch: EventEditPatch): boolean {
  return Object.keys(patch).length === 0;
}

/**
 * The form's values as a patch of what changed.
 *
 * Stored text is compared trimmed, as the form's is: the API doesn't trim on
 * write, and a stray space must not read as a change (a location in the patch
 * pages the chapter). The rule is compared by value with the series' rule, so
 * an unchanged one isn't sent: a changed one rebuilds the series.
 */
export function eventEditPatch(
  stored: EventEditStored,
  seriesRule: string | null,
  values: EventEditValues,
): EventEditPatch {
  const patch: EventEditPatch = {};
  const text = (value: string | null | undefined) => (value ?? "").trim();
  if (values.name !== undefined && values.name.trim() !== text(stored.name)) {
    patch.name = values.name.trim();
  }
  if (values.start && !sameInstant(values.start, stored.start_time)) {
    patch.start_time = values.start.toISOString();
  }
  if (values.end && !sameInstant(values.end, stored.end_time)) {
    patch.end_time = values.end.toISOString();
  }
  for (const key of ["location", "description", "notes"] as const) {
    const next = values[key];
    if (next !== undefined && next.trim() !== text(stored[key])) {
      patch[key] = next.trim();
    }
  }
  if (
    values.point_value !== undefined &&
    values.point_value !== (stored.point_value ?? 0)
  ) {
    patch.point_value = values.point_value;
  }
  if (
    values.check_in_opens_minutes !== undefined &&
    values.check_in_opens_minutes !== stored.check_in_opens_minutes
  ) {
    patch.check_in_opens_minutes = values.check_in_opens_minutes;
  }
  if (
    values.attendance &&
    !sameWire(
      values.attendance,
      attendanceToWire(attendanceFromEvent(stored.attendance)),
    )
  ) {
    // All five together: they are one rule, and an emptied list must clear.
    Object.assign(patch, values.attendance);
  }
  if (
    values.event_type_id !== undefined &&
    values.event_type_id !== stored.event_type_id
  ) {
    patch.event_type_id = values.event_type_id;
  }
  if (
    values.recurrence_rule !== undefined &&
    values.recurrence_rule !== seriesRule
  ) {
    patch.recurrence_rule = values.recurrence_rule;
  }
  if (
    values.check_in_zone !== undefined &&
    !sameZone(values.check_in_zone, storedZone(stored.check_in_zone))
  ) {
    patch.check_in_zone = values.check_in_zone;
  }
  if (
    values.check_in_zone_name !== undefined &&
    values.check_in_zone_name.trim() !== text(stored.check_in_zone_name)
  ) {
    patch.check_in_zone_name = values.check_in_zone_name.trim();
  }
  return patch;
}

/**
 * Whether saving has to ask "this event or all upcoming". A Repeat change is
 * about the series, so it isn't asked.
 */
export function saveScopeFor(
  target: EventEditTarget,
  patch: EventEditPatch,
  now: Date,
): EventEditScope | "ask" {
  if (patch.recurrence_rule !== undefined) return "series";
  return offersSeriesChoice(target, now) ? "ask" : "instance";
}

/** The request one save makes. */
export interface EventSaveRequest {
  id: string;
  scope: EventEditScope;
  body: EventEditPatch;
}

/**
 * Where a save goes, and with what times.
 *
 * Everything but a series edit from a generated occurrence goes to the event
 * itself. That one goes to the parent, with any time change carried over as a
 * shift of the parent's own start and the occurrence's new length.
 */
export function saveRequestFor(
  target: EventEditTarget,
  patch: EventEditPatch,
  scope: EventEditScope,
): EventSaveRequest {
  const { event, parent } = target;
  if (scope !== "series" || !event.parent_event_id || !parent) {
    return { id: event.id, scope, body: patch };
  }
  const body: EventEditPatch = { ...patch };
  delete body.start_time;
  delete body.end_time;
  if (patch.start_time !== undefined || patch.end_time !== undefined) {
    const oldStart = new Date(event.start_time).getTime();
    const newStart = new Date(patch.start_time ?? event.start_time).getTime();
    const newEnd = new Date(patch.end_time ?? event.end_time).getTime();
    const parentStart =
      new Date(parent.start_time).getTime() + (newStart - oldStart);
    body.start_time = new Date(parentStart).toISOString();
    body.end_time = new Date(parentStart + (newEnd - newStart)).toISOString();
  }
  return { id: parent.id, scope, body };
}

/**
 * Whether the screen should leave the event after a save, because the event
 * it shows may no longer be the one that changed.
 *
 * A series save that moves the times or changes Repeat rebuilds the upcoming
 * occurrences with new ids, so a generated occurrence on screen is gone. And
 * a series whose first event already started moves the series onto its next
 * event, which comes back with a different id. In both cases the Events list
 * is where the officer can see what changed.
 */
export function leavesAfterSave(
  request: EventSaveRequest,
  target: EventEditTarget,
  savedId: string | null,
): boolean {
  if (request.scope !== "series") return false;
  const rebuilds =
    request.body.start_time !== undefined ||
    request.body.end_time !== undefined ||
    request.body.recurrence_rule !== undefined;
  if (target.event.parent_event_id) return rebuilds;
  return savedId !== null && savedId !== target.event.id;
}
