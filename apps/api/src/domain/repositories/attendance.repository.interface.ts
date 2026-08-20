import { EventAttendance } from '../entities/event-attendance.entity';

export const ATTENDANCE_REPOSITORY = 'ATTENDANCE_REPOSITORY';

export interface IAttendanceRepository {
  findByEvent(eventId: string): Promise<EventAttendance[]>;
  findByEventAndUser(
    eventId: string,
    userId: string,
  ): Promise<EventAttendance | null>;
  createMany(data: Partial<EventAttendance>[]): Promise<EventAttendance[]>;
  update(id: string, data: Partial<EventAttendance>): Promise<EventAttendance>;
  /**
   * Atomically insert the attendance row and award the event's ATTENDANCE
   * points in a single DB transaction (RPC `check_in_event`). Returns null when
   * the member is already checked in (the unique (event_id, user_id) index wins
   * the race), which the caller maps to a 409 Conflict.
   */
  checkInAtomic(
    eventId: string,
    userId: string,
    chapterId: string,
    checkInTime: string,
    pointValue: number,
    eventName: string,
  ): Promise<EventAttendance | null>;
}
