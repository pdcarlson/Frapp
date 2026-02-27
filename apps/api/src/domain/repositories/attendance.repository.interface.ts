import { EventAttendance } from '../entities/event-attendance.entity';

export const ATTENDANCE_REPOSITORY = 'ATTENDANCE_REPOSITORY';

export interface IAttendanceRepository {
  findById(id: string): Promise<EventAttendance | null>;
  findByEvent(eventId: string): Promise<EventAttendance[]>;
  findByEventAndUser(
    eventId: string,
    userId: string,
  ): Promise<EventAttendance | null>;
  create(data: Partial<EventAttendance>): Promise<EventAttendance>;
  update(id: string, data: Partial<EventAttendance>): Promise<EventAttendance>;
  delete(id: string): Promise<void>;
}
