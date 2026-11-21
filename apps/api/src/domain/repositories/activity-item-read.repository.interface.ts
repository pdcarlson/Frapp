import type {
  ActivityItemKind,
  ActivityItemRead,
  ActivityItemSnooze,
} from '../entities/activity-item-read.entity';

export const ACTIVITY_ITEM_READ_REPOSITORY = 'ACTIVITY_ITEM_READ_REPOSITORY';

/** One Activity item, by its module's kind and id. */
export interface ActivityItemRef {
  kind: ActivityItemKind;
  item_id: string;
}

/**
 * Which Activity items each member opened, and when, and when their unread
 * dots began (#4173, `spec/behavior/activity.md` § Unread). Every method is
 * scoped by chapter and member: this state is the member's own and nobody
 * else ever reads it.
 */
export interface IActivityItemReadRepository {
  /** When the member's dots began in the chapter; null when they haven't. */
  findUnreadStart(chapterId: string, userId: string): Promise<string | null>;
  /** Begins the member's dots at `startedAt`, unless they already began. */
  startUnread(
    chapterId: string,
    userId: string,
    startedAt: string,
  ): Promise<void>;
  /**
   * The member's reads in the chapter of any item whose id is in `itemIds`,
   * whatever its kind. An empty `itemIds` reads nothing.
   */
  findReads(
    chapterId: string,
    userId: string,
    itemIds: string[],
  ): Promise<ActivityItemRead[]>;
  /** Records that the member opened these items now. Idempotent. */
  markRead(
    chapterId: string,
    userId: string,
    items: ActivityItemRef[],
    readAt: string,
  ): Promise<void>;
  /**
   * The member's snoozes in the chapter that end after `endedAfter`: the
   * active ones and those that ended since, whose end decides whether their
   * row came back unread (`spec/behavior/activity.md` § Snooze).
   */
  findSnoozes(
    chapterId: string,
    userId: string,
    endedAfter: string,
  ): Promise<ActivityItemSnooze[]>;
  /** Snoozes the item until `until`, replacing any snooze it had. */
  snooze(
    chapterId: string,
    userId: string,
    item: ActivityItemRef,
    until: string,
  ): Promise<void>;
  /** Drops the member's snooze of the item, if any. Idempotent. */
  unsnooze(
    chapterId: string,
    userId: string,
    item: ActivityItemRef,
  ): Promise<void>;
}
