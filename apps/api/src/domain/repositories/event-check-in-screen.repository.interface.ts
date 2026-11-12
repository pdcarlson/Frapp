import type { EventCheckInScreen } from '../entities/event-check-in-screen.entity';

export const EVENT_CHECK_IN_SCREEN_REPOSITORY =
  'EVENT_CHECK_IN_SCREEN_REPOSITORY';

/** Officers' screens showing an event's check-in QR (#4532). API only. */
export interface IEventCheckInScreenRepository {
  /**
   * The event's live rows (`expires_at` after `nowIso`), one per officer
   * showing the code, inside the caller's chapter.
   */
  findLive(
    eventId: string,
    chapterId: string,
    nowIso: string,
  ): Promise<EventCheckInScreen[]>;

  /**
   * Record one officer's screen showing the code, replacing their own row,
   * location included: with `location: null` their row stops anchoring
   * anything, so a phone that lost its fix never leaves an old spot behind.
   * Other officers' rows are untouched.
   */
  recordShown(input: {
    eventId: string;
    reportedBy: string;
    chapterId: string;
    nowIso: string;
    expiresAt: string;
    location: { lat: number; lng: number; accuracy_m: number } | null;
  }): Promise<EventCheckInScreen>;

  /**
   * Delete every row whose check-in window has closed, in every chapter (the
   * retention sweep). Returns the count.
   */
  deleteExpired(nowIso: string): Promise<number>;
}
