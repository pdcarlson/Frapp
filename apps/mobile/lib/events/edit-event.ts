import {
  attendanceInvitesNobody,
  attendanceFromEvent,
  attendanceToWire,
  eventEditPatch,
  repeatDraftFromRule,
  repeatEditSeriesOf,
  repeatRuleForEdit,
  type EventEditPatch,
  type EventEditTarget as SharedEventEditTarget,
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
 * What a save sends, and whether it asks "this event or all upcoming", is
 * shared with web: `event-edit.ts` in `@repo/validation` (#3667). This file
 * only turns the phone's draft into that module's values.
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

/** The event being edited, and what the form needs to know about its series. */
export type EventEditTarget = SharedEventEditTarget<EventDetail>;

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
  const startMoved = start.getTime() !== new Date(event.start_time).getTime();
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

  // A changed rule steps from the meeting that is the series' first once
  // this save lands (`repeatEditAnchor`).
  const repeat = repeatRuleForEdit(
    draft.repeat,
    repeatEditSeriesOf(target, start, now),
  );
  if (!repeat.ok) errors.repeat = repeat.error;

  if (Object.keys(errors).length > 0 || opens === null || !repeat.ok) {
    return { ok: false, errors };
  }

  const patch = eventEditPatch(event, seriesRule, {
    name,
    start,
    end,
    location: draft.location,
    description: draft.description,
    point_value: points.kind === "value" ? points.points : 0,
    check_in_opens_minutes: opens,
    attendance: wire,
    event_type_id: draft.eventTypeId,
    // An untouched draft gives back the stored string itself.
    recurrence_rule: repeat.rule,
  });
  return { ok: true, patch };
}
