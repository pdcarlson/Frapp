import { Event, EventAttendance } from '../entities/event.entity';

export const EVENT_REPOSITORY = 'EVENT_REPOSITORY';

export interface IEventRepository {
  create(event: Omit<Event, 'id' | 'createdAt'>): Promise<Event>;
  findById(id: string): Promise<Event | null>;
  findByChapter(chapterId: string): Promise<Event[]>;

  // Attendance
  upsertAttendance(
    attendance: Omit<EventAttendance, 'id' | 'createdAt'>,
  ): Promise<EventAttendance>;
  findAttendance(
    eventId: string,
    userId: string,
  ): Promise<EventAttendance | null>;
  findAttendanceByEvent(eventId: string): Promise<EventAttendance[]>;
}
