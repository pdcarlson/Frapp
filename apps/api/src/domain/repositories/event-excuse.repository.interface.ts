import type {
  EventExcuse,
  EventExcuseStatus,
} from '../entities/event-excuse.entity';

export const EVENT_EXCUSE_REPOSITORY = 'EVENT_EXCUSE_REPOSITORY';

export interface IEventExcuseRepository {
  /** Every excuse for one event in the chapter, oldest first. */
  findByEvent(chapterId: string, eventId: string): Promise<EventExcuse[]>;
  findByEventAndUser(
    chapterId: string,
    eventId: string,
    userId: string,
  ): Promise<EventExcuse | null>;
  /** The user ids holding an excuse of one of `statuses` for the event. */
  findUserIdsByEventAndStatus(
    chapterId: string,
    eventId: string,
    statuses: readonly EventExcuseStatus[],
  ): Promise<string[]>;
  /**
   * Insert a PENDING excuse. Returns null when the member already has one for
   * the event (the unique `(event_id, user_id)` constraint), which the caller
   * maps to a 409.
   */
  create(
    data: Pick<EventExcuse, 'chapter_id' | 'event_id' | 'user_id' | 'reason'>,
  ): Promise<EventExcuse | null>;
  /**
   * Decide a PENDING excuse and write the attendance it implies, atomically
   * (RPC `decide_event_excuse`). Null when it was no longer pending.
   */
  decideAtomic(
    excuseId: string,
    chapterId: string,
    decision: 'APPROVED' | 'DECLINED',
    decidedBy: string,
    markAbsent: boolean,
  ): Promise<EventExcuse | null>;
  /**
   * Delete a PENDING or APPROVED excuse, and an approved one's EXCUSED
   * attendance row, atomically (RPC `withdraw_event_excuse`). Null when there
   * was none to withdraw.
   */
  withdrawAtomic(
    chapterId: string,
    eventId: string,
    userId: string,
  ): Promise<EventExcuse | null>;
}
