import { EventAttendance } from '../entities/event-attendance.entity';

export const ATTENDANCE_REPOSITORY = 'ATTENDANCE_REPOSITORY';

export interface IAttendanceRepository {
  findByEvent(eventId: string): Promise<EventAttendance[]>;
  findByEventAndUser(
    eventId: string,
    userId: string,
  ): Promise<EventAttendance | null>;
  /**
   * One member's rows for many events, in one read. Events with no row for
   * the member are simply absent from the result.
   */
  findByUserForEvents(
    userId: string,
    eventIds: readonly string[],
  ): Promise<EventAttendance[]>;
  /**
   * Every row for many events, in one read: Activity's count of who has
   * checked in to the events a member made (#4792).
   */
  findByEvents(eventIds: readonly string[]): Promise<EventAttendance[]>;
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
