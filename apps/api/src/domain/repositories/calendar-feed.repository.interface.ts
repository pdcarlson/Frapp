import type { CalendarFeed } from '../entities/calendar-feed.entity';

export const CALENDAR_FEED_REPOSITORY = 'CALENDAR_FEED_REPOSITORY';

export interface ICalendarFeedRepository {
  /**
   * The link a token names, live or revoked, in whichever chapter it belongs
   * to. Deliberately unscoped: a calendar app fetching the link carries no
   * chapter or sign-in, so the secret token is the boundary, as an invite's
   * is.
   */
  findByToken(token: string): Promise<CalendarFeed | null>;
  /** The member's live link in the chapter, or null. */
  findLive(chapterId: string, userId: string): Promise<CalendarFeed | null>;
  create(data: {
    chapter_id: string;
    user_id: string;
    token: string;
  }): Promise<CalendarFeed>;
  /** Stamp `revoked_at` on the member's live link in the chapter, if any. */
  revokeLive(chapterId: string, userId: string): Promise<void>;
}
