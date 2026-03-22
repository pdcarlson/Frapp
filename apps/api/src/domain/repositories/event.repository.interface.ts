import { Event } from '../entities/event.entity';

export const EVENT_REPOSITORY = 'EVENT_REPOSITORY';

export interface IEventRepository {
  findById(id: string, chapterId: string): Promise<Event | null>;
  findByChapter(chapterId: string): Promise<Event[]>;
  findInstancesByParentId(
    parentEventId: string,
    chapterId: string,
  ): Promise<Event[]>;
  create(data: Partial<Event>): Promise<Event>;
  update(id: string, chapterId: string, data: Partial<Event>): Promise<Event>;
  delete(id: string, chapterId: string): Promise<void>;
}
