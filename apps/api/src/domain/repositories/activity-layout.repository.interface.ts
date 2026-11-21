import type { ActivityLayout } from '../entities/activity-layout.entity';

export const ACTIVITY_LAYOUT_REPOSITORY = 'ACTIVITY_LAYOUT_REPOSITORY';

/** The two lists a member saves together. */
export interface ActivityLayoutLists {
  card_order: string[];
  hidden_cards: string[];
}

/**
 * A member's own Activity card arrangement (#5520): `activity_layouts`.
 *
 * **Every method takes both the chapter and the member, and every query
 * filters on both.** Chapter-first, per the repository convention, because
 * both are `string` and a transposition would type-check. There is no method
 * that reads another member's arrangement.
 */
export interface IActivityLayoutRepository {
  /** The member's row, or `null` when they have never saved one. */
  find(chapterId: string, userId: string): Promise<ActivityLayout | null>;
  /** Writes both lists whole, creating the row on first use. */
  upsert(
    chapterId: string,
    userId: string,
    lists: ActivityLayoutLists,
  ): Promise<ActivityLayout>;
  /** Removes the row. Idempotent: a member with no row is left as they are. */
  delete(chapterId: string, userId: string): Promise<void>;
}
