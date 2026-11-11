/**
 * One of a chapter's kinds of event (`event_types`, #3730): "Chapter meeting",
 * "Philanthropy", "Work party".
 *
 * A type carries the points and attendance an event of that kind starts from.
 * Picking one in the New event form copies them onto the event, which keeps
 * its own values from then on: editing a type never rewrites events already
 * made. `position` orders the chapter's list, lowest first.
 */
export interface EventType {
  id: string;
  chapter_id: string;
  name: string;
  /** Points for attending an event of this type, `0 … POINTS_ADJUSTMENT_MAX`. */
  point_value: number;
  /** Whether everyone must attend an event of this type. */
  is_mandatory: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}
