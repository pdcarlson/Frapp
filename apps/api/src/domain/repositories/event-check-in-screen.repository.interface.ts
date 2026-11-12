import type { EventCheckInScreen } from '../entities/event-check-in-screen.entity';

export const EVENT_CHECK_IN_SCREEN_REPOSITORY =
  'EVENT_CHECK_IN_SCREEN_REPOSITORY';

/** Where an event's check-in QR screen is (#4532). API only. */
export interface IEventCheckInScreenRepository {
  /**
   * The event's row while it is still live (`expires_at` after `nowIso`),
   * inside the caller's chapter.
   */
  findLive(
    eventId: string,
    chapterId: string,
    nowIso: string,
  ): Promise<EventCheckInScreen | null>;

  /**
   * Record a screen showing the code, and return the row as it now stands.
   * With `location`, it replaces the stored one. Without, any location
   * another screen gave stays: a laptop that can't tell where it is must not
   * turn the distance check off for the phone beside it.
   */
  recordShown(input: {
    eventId: string;
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
