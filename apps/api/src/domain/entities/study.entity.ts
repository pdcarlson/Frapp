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
  created_at: string;
}

export type StudySessionStatus =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'PAUSED_EXPIRED'
  | 'LOCATION_INVALID';

export interface StudySession {
  id: string;
  chapter_id: string;
  user_id: string;
  geofence_id: string;
  status: StudySessionStatus;
  start_time: string;
  end_time: string | null;
  last_heartbeat_at: string;
  total_foreground_minutes: number;
  points_awarded: boolean;
  created_at: string;
}
