import type { AiSuggestion } from "@repo/hooks";
import { proposedRepeatDraft } from "@repo/validation";
import { emptyEventDraft, type NewEventDraft } from "@/lib/events/create-event";

type ProposedEvent = NonNullable<AiSuggestion["new_event"]>;

/**
 * The New event form, filled in from an event Ask proposed (#5117): the
 * card's Edit opens the ordinary form on it, so attendance by role, a longer
 * end, notes, a repeat and everything else the card does not show are
 * changed where an officer already changes them. What the card left unsaid
 * keeps the form's own default (points the card could not fill, #5148, take
 * the form's default amount). Every field is the officer's to change, and
 * Create in the form is the confirm.
 */
export function proposedEventTemplate(event: ProposedEvent): NewEventDraft {
  const empty = emptyEventDraft();
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  return {
    ...empty,
    name: event.name,
    start: Number.isNaN(start.getTime()) ? null : start,
    end: Number.isNaN(end.getTime()) ? null : end,
    location: event.location ?? "",
    pointsInput:
      event.point_value === null
        ? empty.pointsInput
        : String(event.point_value),
    attendance: {
      everyone: event.is_mandatory ? "required" : "optional",
      roles: {},
    },
    repeat: proposedRepeatDraft(event.recurrence_rule),
    description: event.description ?? "",
    // The type the card matched (#5148), as Confirm would make it.
    eventTypeId: event.event_type_id ?? null,
    // Open on what the card did not show: who's coming, the repeat, notes.
    showMore: true,
  };
}
