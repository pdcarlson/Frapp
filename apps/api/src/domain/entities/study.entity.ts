export interface GeofenceCoordinate {
  lat: number;
  lng: number;
}

export interface StudyGeofence {
  id: string;
  chapter_id: string;
  name: string;
  coordinates: GeofenceCoordinate[];
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
  created_at: string;
}
