import { nameForThisYear, sameWeekdayThisYear } from "@repo/formatting";
import { noRepeatDraft } from "@repo/validation";
import type { NewEventDraft } from "@/lib/events/create-event";
import { draftFromEvent } from "@/lib/events/edit-event";
import type { EventDetail } from "@/lib/events/select";

/**
 * The New event form, filled in from an event the chapter held a year ago
 * (#3930, `spec/behavior/ai.md` § This time last year): everything the
 * officer could read on last year's event, on the same weekday and hour this
 * year, with a year in its name moved on ("Winter Formal 2025" becomes
 * "Winter Formal 2026"). Web's event form opens the same way
 * (`components/ai/suggested-events.tsx`).
 *
 * Always a one-time event: a series from last year is suggested once, and
 * repeating it is the officer's choice in the form. A start that can't be
 * read leaves the times unpicked, and the form offers its usual default.
 */
export function lastYearTemplate(
  event: EventDetail,
  now: Date = new Date(),
): NewEventDraft {
  const start = sameWeekdayThisYear(event.start_time, now);
  // The end keeps its distance from the start. Moving it on its own would
  // shorten an event of a week or more to what is left over after whole
  // weeks, and one of exactly a week to nothing.
  const length =
    new Date(event.end_time).getTime() - new Date(event.start_time).getTime();
  const end =
    start && Number.isFinite(length) && length > 0
      ? new Date(start.getTime() + length)
      : null;
  return {
    ...draftFromEvent({ event, seriesRule: null, parent: null }),
    name: nameForThisYear(event.name, event.start_time, start),
    start,
    end,
    repeat: noRepeatDraft(),
  };
}
