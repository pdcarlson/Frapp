import type {
  ActivityItemKind,
  ActivityItemRead,
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
}
