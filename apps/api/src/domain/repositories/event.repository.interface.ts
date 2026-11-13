import { Event } from '../entities/event.entity';
import type { EventExcuse } from '../entities/event-excuse.entity';

/** One rebuilt occurrence's old id and the new one replacing it (#4620). */
export interface OccurrenceCarry {
  from: string;
  to: string;
}

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
   * Events one member made that have not ended by `endsAfter`
   * (`end_time >= endsAfter`), earliest start first, at most `limit` rows.
   * An event with no recorded creator is never returned.
   */
  /**
   * The events among `ids` that are in this chapter, in no order. An id from
   * another chapter, or one that no longer exists, is left out.
   */
  findByIds(ids: readonly string[], chapterId: string): Promise<Event[]>;
  findCreatedBy(
    chapterId: string,
    createdBy: string,
    endsAfter: string,
    limit: number,
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
  /**
   * Delete the upcoming occurrences a series edit rebuilt (#4620), carrying
   * each `carry` pair's excuses, and an approved one's EXCUSED attendance
   * row, from the old meeting to the new one in the same transaction (RPC
   * `delete_replaced_occurrences`). Returns the pending and approved excuses
   * left on old rows no pair carried, deleted with them.
   */
  deleteReplacedOccurrences(
    ids: string[],
    chapterId: string,
    carry: readonly OccurrenceCarry[],
  ): Promise<EventExcuse[]>;
}
