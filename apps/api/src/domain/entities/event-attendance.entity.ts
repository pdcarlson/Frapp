export type EventAttendanceStatus = 'PRESENT' | 'EXCUSED' | 'ABSENT' | 'LATE';

export interface EventAttendance {
  id: string;
  event_id: string;
  user_id: string;
  status: EventAttendanceStatus;
  check_in_time: string | null;
  excuse_reason: string | null;
  marked_by: string | null;
  created_at: string;
}
