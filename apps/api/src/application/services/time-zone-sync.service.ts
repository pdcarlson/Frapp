import { Inject, Injectable, Logger } from '@nestjs/common';
import { isSupportedTimeZone } from '@repo/validation';
import { USER_SETTINGS_REPOSITORY } from '#domain/repositories/notification.repository.interface';
import type { IUserSettingsRepository } from '#domain/repositories/notification.repository.interface';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/** How many members' last-recorded zones one process remembers. */
const REMEMBERED_MEMBERS = 5_000;

/**
 * Keeps `user_settings.time_zone` matching the zone the member's device reports
 * (`x-time-zone`), so pushes can name times in it.
 *
 * Every authenticated request carries the header, so this must cost nothing on
 * the common path: a per-process memo of the zone last written for each member
 * answers "unchanged" without a read. A new process, a new member, or a member
 * who travelled writes once. The write is fire-and-forget: the request never
 * waits on it, and a failure only means the next request tries again.
 */
@Injectable()
export class TimeZoneSyncService {
  private readonly logger = new Logger(TimeZoneSyncService.name);
  private readonly recorded = new Map<string, string>();

  constructor(
    @Inject(USER_SETTINGS_REPOSITORY)
    private readonly settingsRepo: IUserSettingsRepository,
  ) {}

  /** Record `header` as `userId`'s zone if it is a usable zone and new. */
  record(userId: string, header: unknown): void {
    const timeZone = typeof header === 'string' ? header.trim() : '';
    if (!isSupportedTimeZone(timeZone)) return;
    if (this.recorded.get(userId) === timeZone) return;

    this.remember(userId, timeZone);
    this.settingsRepo.setTimeZone(userId, timeZone).catch((error: unknown) => {
      // Forget it, so the member's next request tries again.
      if (this.recorded.get(userId) === timeZone) this.recorded.delete(userId);
      logThrowable(
        this.logger,
        'warn',
        `Failed to record the time zone for user ${userId}`,
        error,
      );
    });
  }

  private remember(userId: string, timeZone: string): void {
    // A Map iterates in insertion order, so re-inserting keeps the most recent
    // members at the end and the first key is the one heard from longest ago.
    this.recorded.delete(userId);
    this.recorded.set(userId, timeZone);
    if (this.recorded.size > REMEMBERED_MEMBERS) {
      const oldest = this.recorded.keys().next().value;
      if (oldest !== undefined) this.recorded.delete(oldest);
    }
  }
}
