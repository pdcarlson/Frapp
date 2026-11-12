export interface GeofenceCoordinate {
  lat: number;
  lng: number;
}

/** A circle zone as the officer drew it: center and radius in meters. */
export interface GeofenceCircle {
  lat: number;
  lng: number;
  radius_m: number;
}

export interface StudyGeofence {
  id: string;
  chapter_id: string;
  name: string;
  /**
   * The polygon containment is checked against. For a circle zone it is the
   * polygon `circleToPolygon` derived from `circle`, written by the API, never
   * by a client.
   */
  coordinates: GeofenceCoordinate[];
  /**
   * Set when the zone was drawn as a circle, so the editor reopens it as one;
   * null for an outline.
   */
  circle: GeofenceCircle | null;
  is_active: boolean;
  minutes_per_point: number;
  points_per_interval: number;
  min_session_minutes: number;
  /** Minutes a session may stay paused before auto-expiring as PAUSED_EXPIRED. */
  pause_grace_minutes: number;
  created_at: string;
}

export type StudySessionStatus =
  'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'PAUSED_EXPIRED' | 'LOCATION_INVALID';

export interface StudySession {
  id: string;
  chapter_id: string;
  user_id: string;
  geofence_id: string;
  status: StudySessionStatus;
  start_time: string;
  end_time: string | null;
  /**
   * Watermark up to which foreground time has been credited — not literally
   * the arrival time of the last heartbeat. It advances by whole credited
   * minutes so sub-minute remainders carry into the next interval instead of
   * being truncated away each time.
   */
  last_heartbeat_at: string;
  /**
   * When the session was backgrounded, or null while running in the
   * foreground. Pause is a sub-state of ACTIVE, not a status of its own.
   */
  paused_at: string | null;
  total_foreground_minutes: number;
  points_awarded: boolean;
  /**
   * Consecutive heartbeats rejected for GPS accuracy > 100m. Reset to 0 on
   * any accepted heartbeat; reaching 2 expires the session as
   * `LOCATION_INVALID`. Distinct from an out-of-polygon miss, which expires
   * the session immediately as `EXPIRED`.
   */
  location_reject_streak: number;
  created_at: string;
}
