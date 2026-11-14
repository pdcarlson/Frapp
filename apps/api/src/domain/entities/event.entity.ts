import type { GeofenceCoordinate } from './study.entity';
import type { EventAgendaItem, EventAttachment } from '@repo/validation';

export interface Event {
  id: string;
  chapter_id: string;
  name: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  point_value: number;
  is_mandatory: boolean;
  recurrence_rule: string | null;
  parent_event_id: string | null;
  /**
   * Who the event is for, by role (`spec/behavior/events.md` § Attendance by
   * role; the rule is `eventAttendanceFor` in `@repo/validation`). Roles that
   * must attend; `optional_role_ids` are invited, `excluded_role_ids` are not.
   */
  required_role_ids: string[] | null;
  optional_role_ids: string[] | null;
  excluded_role_ids: string[] | null;
  /**
   * Whether a member holding none of the listed roles is invited. When it is,
   * `is_mandatory` says whether they must attend.
   */
  others_invited: boolean | null;
  notes: string | null;
  /**
   * Optional check-in geofence: the polygon a member must be standing inside for
   * a check-in to be accepted (`spec/ui/mobile/patterns.md` § QR check-in — the
   * zone, not the rotating code, is the anti-proxy control).
   *
   * `null` means the event has no geofence and check-in skips the zone test.
   * A **malformed** value is not the same thing and must fail closed — validate
   * with `isValidZone` (`domain/utils/geofence.ts`) rather than truthiness.
   *
   * Shares `GeofenceCoordinate` with study sessions so one `pointInPolygon`
   * serves both; the events column is deliberately independent of
   * `study_geofences`, whose rows carry study-only scoring config.
   */
  check_in_zone: GeofenceCoordinate[] | null;
  /** Human-readable name for `check_in_zone`, rendered on the s18 status line. */
  check_in_zone_name: string | null;
  /**
   * Minutes before `start_time` that check-in opens (0–120, default 10;
   * `spec/behavior/events.md` § Check-In). The window is
   * `checkInWindowBounds` in `@repo/validation`.
   */
  check_in_opens_minutes: number;
  /**
   * The chapter's event type this was made as (`event_types`, #3730), or
   * `null`. The type only filled in the form: the event's own `point_value`
   * and `is_mandatory` are what count. Deleting the type clears this.
   */
  event_type_id: string | null;
  /**
   * Who made the event: the caller of `POST /v1/events`, copied onto a
   * series' generated occurrences. `null` for events made before it was
   * recorded (#3897) and for rows written outside that route.
   */
  created_by: string | null;
  /**
   * This meeting's agenda, in order (#4934): short items whoever can edit the
   * event writes and checks off. Belongs to this one meeting, never to a
   * series: a new occurrence starts with none, and only a rebuilt meeting
   * inherits the one it replaces (`delete_replaced_occurrences`).
   */
  agenda: EventAgendaItem[];
  /**
   * Titled links and Chapter Files documents for this meeting (#4934), owned
   * the same way as `agenda`.
   */
  attachments: EventAttachment[];
  created_at: string;
}
