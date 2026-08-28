import type { GeofenceCoordinate } from './study.entity';

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
  required_role_ids: string[] | null;
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
  created_at: string;
}
