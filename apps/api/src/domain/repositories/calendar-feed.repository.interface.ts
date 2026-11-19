import type { CalendarFeed } from '../entities/calendar-feed.entity';

export const CALENDAR_FEED_REPOSITORY = 'CALENDAR_FEED_REPOSITORY';

export interface ICalendarFeedRepository {
  /**
   * The link whose token hashes to `tokenHash`, live or revoked, in whichever
   * chapter it belongs to. Deliberately unscoped: a calendar app fetching the
   * link carries no chapter or sign-in, so the secret token is the boundary,
   * as an invite's is.
   */
  findByTokenHash(tokenHash: string): Promise<CalendarFeed | null>;
  /** The member's live link in the chapter, or null. */
  findLive(chapterId: string, userId: string): Promise<CalendarFeed | null>;
  create(data: {
    chapter_id: string;
    user_id: string;
    token_hash: string;
    token_sealed: string;
  }): Promise<CalendarFeed>;
  /**
   * Store a legacy link's sealed token and clear its plaintext, in one update
   * that only applies while the plaintext is still there.
   */
  sealLegacy(id: string, tokenSealed: string): Promise<void>;
  /**
   * Up to `limit` links still holding a plaintext token, live or revoked, in
   * any chapter: the boot pass seals them. Unscoped on purpose, since it
   * converts the whole table and returns nothing to a caller.
   */
  findLegacy(limit: number): Promise<CalendarFeed[]>;
  /** Stamp `revoked_at` on the member's live link in the chapter, if any. */
  revokeLive(chapterId: string, userId: string): Promise<void>;
}
