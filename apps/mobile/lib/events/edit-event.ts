import {
  attendanceFromEvent,
  attendanceInvitesNobody,
  attendanceToWire,
  isRepeatRule,
  repeatDraftFromRule,
  repeatRuleOf,
  type EventAttendanceWire,
} from "@repo/validation";
import { parsePointReward } from "@/lib/tasks/create-task";
import {
  CHECK_IN_OPENS_ERROR,
  parseCheckInOpens,
  type NewEventDraft,
  type NewEventErrors,
} from "./create-event";
import type { EventDetail } from "./select";

/**
 * Editing an event from its detail screen (`event-details.tsx`), in the same
 * sheet that creates one (`components/events/new-event-sheet.tsx`).
 *
 * ## Who can
 *
 * Anyone the server lets `PATCH /v1/events/:id`: `events:update`, plus the
 * controller's class-level `members:view`. That is any event in the chapter,
 * not only the viewer's own, the way Google Calendar lets a calendar's editors
 * change any event on it (owner, 2026-11-07). Delete is its own grant,
 * `events:delete`, so a Treasurer can fix a time but not cancel the meeting.
 *
 * ## Only what changed is sent
 *
 * The server pushes "Event Updated" to the chapter whenever a patch carries a
 * time or a location, whether or not it differs. Round-tripping the whole
 * event, as the web editor does, would page everyone for a typo fix in the
 * name. So the patch holds only the fields the officer actually changed, and
 * an untouched form saves nothing.
 *
 * ## Repeating events
 *
 * A series is a parent row that carries the rule plus generated occurrences
 * that carry `parent_event_id` (`spec/behavior/events.md` § Recurrence edit
 * and cancellation scope). Saving an edit to one asks, as Calendar does,
 * whether it is for this event or every upcoming one. There is no "this and
 * past": the server never rewrites a meeting that already happened. A change
 * to Repeat itself is a series change, so it isn't asked.
 *
 * A series edit addressed to a generated occurrence drops its times, because
 * the server can't tell them from the occurrence's own. So a time change for
 * every upcoming event is sent to the series parent as the same *shift*: an
 * hour later on this occurrence is an hour later on the parent, and the
 * server moves the rest with it.
 */

/** The permissions `PATCH /v1/events/:id` needs. */
export const EDIT_EVENT_PERMISSIONS = [
  "events:update",
  "members:view",
] as const;
/** The permissions `DELETE /v1/events/:id` needs. */
export const DELETE_EVENT_PERMISSIONS = [
  "events:delete",
  "members:view",
] as const;

export type EventEditScope = "instance" | "series";

/** The event being edited, and what the form needs to know about its series. */
export interface EventEditTarget {
  event: EventDetail;
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
  parent: Pick<EventDetail, "id" | "start_time" | "end_time"> | null;
}

/**
 * Whether the event belongs to a repeating series: any rule the API accepts,
 * a structured one included, so a rename on a structured series' head goes
 * series-wide.
 */
export function isInSeries(event: EventDetail): boolean {
  return !!event.parent_event_id || isRepeatRule(event.recurrence_rule);
}

/**
 * The series rule an edit form should show for this event. Legacy tokens only
 * until the Repeat control reads structured rules (#4488's UI PR); a
 * structured rule shows as none and is left as it is.
 */
export function seriesRuleOf(
  event: EventDetail,
  parent: Pick<EventDetail, "recurrence_rule"> | null,
): string | null {
  const rule = event.parent_event_id
    ? parent?.recurrence_rule
    : event.recurrence_rule;
  return isRepeatRule(rule) ? rule : null;
}

/** The stored event as the form's draft. */
export function draftFromEvent(target: EventEditTarget): NewEventDraft {
  const { event, seriesRule } = target;
  return {
    eventTypeId: event.event_type_id,
    typeFilledName: null,
    name: event.name,
    start: new Date(event.start_time),
    end: new Date(event.end_time),
    location: event.location ?? "",
    pointsInput: String(event.point_value ?? 0),
    checkInOpensInput: String(event.check_in_opens_minutes),
    attendance: attendanceFromEvent(event.attendance),
    repeat: repeatDraftFromRule(seriesRule),
    description: event.description ?? "",
    showMore: false,
  };
}

/** The fields an edit may send. Absent means unchanged. */
export interface EventEditPatch {
  name?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
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

/**
 * The draft as a patch of what changed, or the reasons it can't be saved.
 *
 * The create rules apply, with one difference: an event already under way
 * keeps its start. Only a start the officer moved has to be in the future,
 * so the end of tonight's meeting can still be pushed back during it.
 */
export function validateEventEdit(
  draft: NewEventDraft,
  target: EventEditTarget,
  now: Date,
): { ok: true; patch: EventEditPatch } | { ok: false; errors: NewEventErrors } {
  const { event, seriesRule } = target;
  const errors: NewEventErrors = {};
  const name = draft.name.trim();
  if (name.length === 0) errors.name = "Give the event a name.";

  const start = draft.start ?? new Date(event.start_time);
  const end = draft.end ?? new Date(event.end_time);
  const startMoved = !sameInstant(start, event.start_time);
  const endMoved = !sameInstant(end, event.end_time);
  if (startMoved && start < now) {
    errors.start = "That start time has already passed.";
  }
  if (end <= start) errors.end = "The event has to end after it starts.";

  const points = parsePointReward(draft.pointsInput);
  if (points.kind === "invalid") {
    errors.points = "Points must be a whole number, up to 100,000.";
  }
  const opens = parseCheckInOpens(draft.checkInOpensInput);
  if (opens === null) errors.checkInOpens = CHECK_IN_OPENS_ERROR;

  const wire = attendanceToWire(draft.attendance);
  if (attendanceInvitesNobody(wire)) {
    errors.attendance = "Nobody is invited. Add a role, or invite everyone.";
  }

  // A rule steps from the series' first meeting, which is the parent's start
  // on a generated occurrence, and the event's own otherwise.
  const repeat = repeatRuleOf(draft.repeat, repeatAnchor(target, start));
  if (!repeat.ok) errors.repeat = repeat.error;

  if (Object.keys(errors).length > 0 || opens === null || !repeat.ok) {
    return { ok: false, errors };
  }

  // Stored values are compared trimmed, as the draft is: the API doesn't
  // trim on write, and a stray space must not read as a change (a location
  // in the patch pages the chapter).
  const patch: EventEditPatch = {};
  if (name !== event.name.trim()) patch.name = name;
  if (startMoved) patch.start_time = start.toISOString();
  if (endMoved) patch.end_time = end.toISOString();
  const location = draft.location.trim();
  if (location !== (event.location ?? "").trim()) patch.location = location;
  const description = draft.description.trim();
  if (description !== (event.description ?? "").trim()) {
    patch.description = description;
  }
  const pointValue = points.kind === "value" ? points.points : 0;
  if (pointValue !== (event.point_value ?? 0)) patch.point_value = pointValue;
  if (opens !== event.check_in_opens_minutes) {
    patch.check_in_opens_minutes = opens;
  }
  if (
    !sameWire(wire, attendanceToWire(attendanceFromEvent(event.attendance)))
  ) {
    // All five together: they are one rule, and an emptied list must clear.
    Object.assign(patch, wire);
  }
  if (draft.eventTypeId !== event.event_type_id) {
    patch.event_type_id = draft.eventTypeId;
  }
  // By value: an unchanged rule is not sent, because a changed one rebuilds
  // the series. An untouched draft gives back the stored string itself.
  if (repeat.rule !== seriesRule) patch.recurrence_rule = repeat.rule;
  return { ok: true, patch };
}

/**
 * The first meeting of the series the Repeat control describes: the parent's
 * on a generated occurrence (when it could be read), else the event's own
 * start as the draft holds it.
 */
export function repeatAnchor(target: EventEditTarget, start: Date): Date {
  return target.event.parent_event_id && target.parent
    ? new Date(target.parent.start_time)
    : start;
}

/** Whether the patch writes nothing. */
export function isEmptyPatch(patch: EventEditPatch): boolean {
  return Object.keys(patch).length === 0;
}

/** Whether the event has started: the server never edits it with the series. */
export function hasStarted(event: EventDetail, now: Date): boolean {
  return new Date(event.start_time).getTime() <= now.getTime();
}

/**
 * Whether the "this event or all upcoming" question applies.
 *
 * Not for a one-time event. Not for one already under way either: a series
 * edit or delete only reaches events that haven't started, so "All upcoming"
 * would skip the very event on screen. And not for a generated occurrence
 * whose parent couldn't be read, since a series time change has to go
 * through the parent.
 */
export function offersSeriesChoice(
  target: EventEditTarget,
  now: Date,
): boolean {
  if (!isInSeries(target.event) || hasStarted(target.event, now)) return false;
  return !target.event.parent_event_id || target.parent !== null;
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
 * Whether the screen should leave after a save, because the event it shows
 * may no longer be the one that changed.
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
