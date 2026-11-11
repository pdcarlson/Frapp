import { EventType } from '../entities/event-type.entity';

export const EVENT_TYPE_REPOSITORY = 'EVENT_TYPE_REPOSITORY';

export interface IEventTypeRepository {
  /** The chapter's list, in its own order. */
  findByChapter(chapterId: string): Promise<EventType[]>;
  findById(id: string, chapterId: string): Promise<EventType | null>;
  /**
   * Resolves to `null` when the chapter already has a type of that name
   * (compared trimmed and case-insensitively by the unique index).
   */
  create(data: Partial<EventType>): Promise<EventType | null>;
  /**
   * `null` when the new name is taken, as {@link create}; `undefined` when no
   * such type exists in the chapter.
   */
  update(
    id: string,
    chapterId: string,
    data: Partial<Pick<EventType, 'name' | 'point_value' | 'is_mandatory'>>,
  ): Promise<EventType | null | undefined>;
  /** Its events keep their points and attendance and lose the type. */
  delete(id: string, chapterId: string): Promise<void>;
}
