import { CALENDAR_KIND_HUE } from "@repo/hooks/activity-agenda";

/**
 * How an event wears its kind on Events (#5560), in one place so the agenda
 * row, the hour grid's block and chip, and the detail sheet's title agree
 * with the navigator's dot and the colour key's swatch.
 */

type EventRow = Record<string, unknown>;

/** An event's id on the page: its `id`, else its name, as the list keys it. */
export function eventIdOf(event: EventRow): string {
  return String(event.id ?? event.name ?? "unknown-event");
}

/** The events hue. */
export const EVENT_HUE = CALENDAR_KIND_HUE.events;

/**
 * An event's fill: a faint sky wash, or, for one required of the viewer, the
 * loudest treatment on the screen, a fuller fill and a sky edge. Never the
 * accent, which marks today.
 */
export function eventKindStyle(isRequired: boolean): {
  backgroundColor: string;
  borderColor?: string;
} {
  return isRequired
    ? {
        backgroundColor: `color-mix(in srgb, ${EVENT_HUE} 22%, transparent)`,
        borderColor: `color-mix(in srgb, ${EVENT_HUE} 60%, transparent)`,
      }
    : { backgroundColor: `color-mix(in srgb, ${EVENT_HUE} 9%, transparent)` };
}
