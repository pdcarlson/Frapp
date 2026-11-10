import { Event } from '../entities/event.entity';

export const EVENT_REPOSITORY = 'EVENT_REPOSITORY';

export interface IEventRepository {
  findById(id: string, chapterId: string): Promise<Event | null>;
  /**
   * The chapter's events, earliest start first. `window` keeps only events
   * that overlap it (`end_time >= endsAfter` and `start_time <= startsBefore`),
   * so a caller after "what is coming up" does not read the chapter's whole
   * history.
   */
  findByChapter(
    chapterId: string,
    window?: { endsAfter: string; startsBefore: string },
  ): Promise<Event[]>;
  /**
   * The generated instances of a recurring event, oldest first.
   *
   * Series operations must resolve children through this **before** deleting a
   * parent: `events.parent_event_id` is `on delete set null`, so deleting the
   * parent first nulls the very pointers the operation needs to find them.
   */
  findChildren(parentId: string, chapterId: string): Promise<Event[]>;
  create(data: Partial<Event>): Promise<Event>;
  /**
   * Insert several rows in one statement, so they all land or none do. A
   * recurring series' generated occurrences go through here (#3235). An
   * empty list writes nothing.
   */
  createMany(data: Partial<Event>[]): Promise<Event[]>;
  update(id: string, chapterId: string, data: Partial<Event>): Promise<Event>;
  updateMany(
    ids: string[],
    chapterId: string,
    data: Partial<Event>,
  ): Promise<Event[]>;
  delete(id: string, chapterId: string): Promise<void>;
  deleteMany(ids: string[], chapterId: string): Promise<void>;
}
