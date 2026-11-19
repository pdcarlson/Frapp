import { ATTENDANCE_SEARCH_FROM } from "./event-attendance";

/**
 * The words of the event form's rows (#5561), one copy for web's
 * `EventEditorDialog` and the phone's `NewEventSheet`, so the two read as
 * one form. The rows' marks are `@repo/theme/event-form-glyphs`; the order
 * is {@link EVENT_FORM_ROWS}. `spec/ui/design-system/components.md`
 * § Property rows owns the pattern.
 */

/** Every row the form can show, top to bottom, on both apps. */
export const EVENT_FORM_ROWS = [
  "type",
  "when",
  "repeat",
  "location",
  "attendance",
  "points",
  "description",
  "notes",
  "checkIn",
] as const;

export type EventFormRow = (typeof EVENT_FORM_ROWS)[number];

/** Each row's label. Notes takes the Meetings module's own word instead. */
export const EVENT_FORM_ROW_LABELS: Record<
  Exclude<EventFormRow, "notes">,
  string
> = {
  type: "Type",
  when: "When",
  repeat: "Repeat",
  location: "Location",
  attendance: "Who's coming",
  points: "Points",
  description: "Description",
  checkIn: "Check-in",
};

/** What an empty row says, in the muted tone. */
export const EVENT_FORM_PLACEHOLDERS = {
  name: "Event name",
  type: "None",
  location: "Add a place",
  description: "Add details",
  notes: "Add notes",
} as const;

/**
 * The line under a member's rows: their event carries no points and requires
 * nobody, whatever its type says (#3709), so a type's "10 points" doesn't
 * read as a promise.
 */
export const EVENT_FORM_MEMBER_NOTE =
  "Events you make carry no points and require nobody.";

/**
 * Past this many types, the Type menu (web) and sheet (phone) get a search,
 * as Who's coming does past as many roles.
 */
export const EVENT_TYPE_SEARCH_FROM = ATTENDANCE_SEARCH_FROM;

/** `"10 points · Required"`: what picking a type sets, in its menu row. */
export function describeEventTypeSets(type: {
  point_value: number;
  is_mandatory: boolean;
}): string {
  const points =
    type.point_value === 0
      ? "No points"
      : `${type.point_value} ${type.point_value === 1 ? "point" : "points"}`;
  return type.is_mandatory ? `${points} · Required` : points;
}

/**
 * The Check-in row's value: when check-in opens, from the parsed field
 * (`null` when the field holds something it refuses), and whether a zone is
 * drawn. `"Opens 10 minutes early"`, `"Opens at the start · In a zone"`.
 */
export function describeCheckIn(
  opensMinutes: number | null,
  zoneDrawn = false,
): string {
  const opens =
    opensMinutes === null
      ? "Opening time needs a fix"
      : opensMinutes === 0
        ? "Opens at the start"
        : `Opens ${opensMinutes} ${opensMinutes === 1 ? "minute" : "minutes"} early`;
  return zoneDrawn ? `${opens} · In a zone` : opens;
}
