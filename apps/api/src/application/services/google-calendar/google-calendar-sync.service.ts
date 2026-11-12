import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GOOGLE_CALENDAR_API,
  GoogleCalendarApiError,
  type GoogleCalendarEventInput,
  type IGoogleCalendarApi,
} from '#domain/adapters/google-calendar.interface';
import {
  GOOGLE_CALENDAR_REPOSITORY,
  type IGoogleCalendarRepository,
} from '#domain/repositories/google-calendar.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import type { GoogleCalendarConnection } from '#domain/entities/google-calendar-connection.entity';
import type { AiTextKeyRing } from '#domain/utils/ai-text-cipher';
import { googleCalendarTokenKeyRing } from '../../../config/google-calendar-config';
import {
  CALENDAR_PAST_DAYS,
  CalendarFeedService,
} from '../calendar-feed/calendar-feed.service';
import { toGoogleEvent } from './google-calendar-events';
import { openRefreshToken } from './google-calendar-token';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/**
 * Writes to Google per sync at most. A first sync of a busy chapter carries
 * on at the next tick, so one member's calendar never holds the worker.
 */
export const GOOGLE_SYNC_WRITE_BUDGET = 100;
/** How long a sync that Google rate-limited, or that failed, waits. */
const RETRY_AFTER_MS = 5 * MINUTE_MS;
/** How long a failed cleanup at Google waits before it is tried again. */
const CLEANUP_RETRY_MS = 30 * MINUTE_MS;
/** How long Frapp keeps trying to clean up at Google before it lets go. */
const CLEANUP_GIVE_UP_MS = 3 * DAY_MS;

export type GoogleSyncOutcome =
  | 'synced'
  | 'more'
  | 'needs_reconnect'
  | 'calendar_removed'
  | 'left_chapter'
  | 'retry'
  | 'skipped';

/**
 * Writes a member's Frapp calendar into their Google account (#3322, step 2;
 * `spec/behavior/events.md` § Google Calendar), and cleans up at Google when
 * they disconnect.
 *
 * A sync reconciles: it reads the events on Frapp's calendar back, writes the
 * items that are missing or changed (each event's id comes from its item, and
 * each carries a hash of what was written, so an unchanged item costs
 * nothing), and deletes the events Frapp wrote whose items are gone. Events a
 * member adds to the calendar by hand carry no hash and are left alone, and so
 * are events that ended before the calendar's window, which stay as history
 * (a task's are not: an open task stays however long ago it was due, so its
 * event goes once the task is done).
 */
@Injectable()
export class GoogleCalendarSyncService {
  private readonly logger = new Logger(GoogleCalendarSyncService.name);
  private readonly keyRing: AiTextKeyRing | null;

  constructor(
    @Inject(GOOGLE_CALENDAR_REPOSITORY)
    private readonly repo: IGoogleCalendarRepository,
    @Inject(GOOGLE_CALENDAR_API)
    private readonly google: IGoogleCalendarApi,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapters: IChapterRepository,
    private readonly feeds: CalendarFeedService,
    config: ConfigService,
  ) {
    this.keyRing = googleCalendarTokenKeyRing({
      GOOGLE_CALENDAR_TOKEN_KEY: config.get<string>(
        'GOOGLE_CALENDAR_TOKEN_KEY',
      ),
    });
  }

  /**
   * Whether this server can sync at all: Google's client and the key the
   * tokens are sealed with. Without them the worker leaves every connection
   * as it is, rather than read an unopenable token as one Google refused.
   */
  isAvailable(): boolean {
    return this.google.isConfigured() && this.keyRing !== null;
  }

  /** One claimed connection: synced if active, cleaned up if disconnecting. */
  async process(
    connection: GoogleCalendarConnection,
    now: Date = new Date(),
  ): Promise<GoogleSyncOutcome> {
    if (connection.status === 'disconnecting') {
      await this.cleanUp(connection, now);
      return 'skipped';
    }
    if (connection.status !== 'active') return 'skipped';
    return this.sync(connection, now);
  }

  async sync(
    connection: GoogleCalendarConnection,
    now: Date = new Date(),
  ): Promise<GoogleSyncOutcome> {
    const refreshToken = this.openToken(connection);
    if (refreshToken === null) {
      // Sealed with a key this server no longer holds: only a new sign-in
      // can mend it.
      await this.repo.finishSync(connection.id, {
        status: 'needs_reconnect',
        last_error: 'token_unreadable',
      });
      return 'needs_reconnect';
    }

    try {
      const accessToken = await this.google.accessToken(refreshToken);
      const chapter = await this.chapters.findById(connection.chapter_id);
      if (!chapter) return 'skipped';
      if (!(await this.feeds.isMember(chapter.id, connection.user_id))) {
        // A former member can't reach Disconnect (the chapter's routes are
        // closed to them), so leaving the chapter disconnects.
        const row = await this.repo.markDisconnecting(connection.id);
        if (row) await this.cleanUp(row, now);
        return 'left_chapter';
      }

      let calendarId = connection.calendar_id;
      if (!calendarId) {
        calendarId = await this.google.createCalendar(accessToken, {
          summary: `${chapter.name} (Frapp)`,
          description:
            'Events and tasks from Frapp, kept up to date by Frapp. Edit them in Frapp: a change made here is replaced when the item next changes in Frapp.',
        });
        await this.repo.setCalendarId(connection.id, calendarId);
      }

      const items = await this.feeds.memberItems(
        chapter,
        connection.user_id,
        now,
      );
      const more = await this.reconcile(
        accessToken,
        calendarId,
        items.map(toGoogleEvent),
        now,
      );
      await this.repo.finishSync(connection.id, {
        last_synced_at: now.toISOString(),
        last_error: null,
        // A first sync of a busy chapter carries on at the next tick.
        ...(more ? { sync_due_at: now.toISOString() } : {}),
      });
      return more ? 'more' : 'synced';
    } catch (error) {
      return this.failed(connection, error, now);
    }
  }

  /**
   * Remove Frapp's calendar from the member's Google account, revoke the
   * sign-in, and drop the row. A calendar the member already deleted, or a
   * sign-in Google already refuses, is fine. Anything else is tried again
   * later, for three days, and then the row goes regardless, since a sealed
   * token kept for nothing is a liability and Google expires an unused
   * refresh token on its own.
   */
  async cleanUp(
    connection: GoogleCalendarConnection,
    now: Date = new Date(),
  ): Promise<void> {
    const refreshToken = this.openToken(connection);
    try {
      if (refreshToken !== null) {
        if (connection.calendar_id) {
          const accessToken = await this.google.accessToken(refreshToken);
          await this.google
            .deleteCalendar(accessToken, connection.calendar_id)
            .catch(ignoreNotFound);
        }
        // Google revokes a whole account's access at once, so the grant
        // stays while another connection (another chapter, or a connection
        // made again) uses the same account.
        const shared =
          connection.google_email !== null &&
          (await this.repo.countForAccount(
            connection.google_email,
            connection.id,
          )) > 0;
        if (!shared) await this.google.revoke(refreshToken);
      }
      await this.repo.delete(connection.id);
    } catch (error) {
      if (error instanceof GoogleCalendarApiError) {
        if (error.kind === 'invalid_grant') {
          await this.repo.delete(connection.id);
          return;
        }
        const askedAt = Date.parse(connection.sync_due_at);
        if (now.getTime() - askedAt > CLEANUP_GIVE_UP_MS) {
          this.logger.warn(
            `Google Calendar cleanup gave up on connection ${connection.id}: ${error.message}`,
          );
          await this.repo.delete(connection.id);
          return;
        }
        await this.repo.deferCleanup(
          connection.id,
          new Date(now.getTime() + CLEANUP_RETRY_MS),
          error.reason,
        );
        return;
      }
      throw error;
    }
  }

  /** Returns whether writes were left for the next sync. */
  private async reconcile(
    accessToken: string,
    calendarId: string,
    desired: GoogleCalendarEventInput[],
    now: Date,
  ): Promise<boolean> {
    const remote = await this.google
      .listEvents(accessToken, calendarId)
      .catch((error: unknown) => {
        if (
          error instanceof GoogleCalendarApiError &&
          error.kind === 'not_found'
        ) {
          throw new CalendarRemovedError();
        }
        throw error;
      });
    const remoteById = new Map(remote.map((event) => [event.id, event]));
    const wanted = new Set(desired.map((event) => event.id));
    const windowStart = now.getTime() - CALENDAR_PAST_DAYS * DAY_MS;
    let budget = GOOGLE_SYNC_WRITE_BUDGET;

    for (const event of desired) {
      const existing = remoteById.get(event.id);
      if (existing?.hash === event.hash) continue;
      if (budget <= 0) return true;
      budget -= 1;
      if (existing) {
        await this.google.updateEvent(accessToken, calendarId, event);
        continue;
      }
      try {
        await this.google.insertEvent(accessToken, calendarId, event);
      } catch (error) {
        // The member deleted it by hand: Google keeps it as cancelled under
        // the same id, and an update brings it back.
        if (
          error instanceof GoogleCalendarApiError &&
          error.kind === 'conflict'
        ) {
          await this.google.updateEvent(accessToken, calendarId, event);
        } else {
          throw error;
        }
      }
    }

    for (const event of remote) {
      if (event.hash === null || wanted.has(event.id)) continue;
      const endsAt = event.endsAt ? Date.parse(event.endsAt) : Number.NaN;
      if (!event.task && !Number.isNaN(endsAt) && endsAt < windowStart) {
        continue;
      }
      if (budget <= 0) return true;
      budget -= 1;
      await this.google
        .deleteEvent(accessToken, calendarId, event.id)
        .catch(ignoreNotFound);
    }
    return false;
  }

  private async failed(
    connection: GoogleCalendarConnection,
    error: unknown,
    now: Date,
  ): Promise<GoogleSyncOutcome> {
    if (error instanceof CalendarRemovedError) {
      // The member deleted Frapp's calendar in Google: they don't want it,
      // so Frapp disconnects rather than making it again.
      const row = await this.repo.markDisconnecting(connection.id);
      if (row) await this.cleanUp({ ...row, calendar_id: null }, now);
      return 'calendar_removed';
    }
    if (error instanceof GoogleCalendarApiError) {
      if (error.kind === 'invalid_grant') {
        await this.repo.finishSync(connection.id, {
          status: 'needs_reconnect',
          last_error: error.reason,
        });
        return 'needs_reconnect';
      }
      await this.repo.finishSync(connection.id, {
        last_error: error.reason,
        sync_due_at: new Date(now.getTime() + RETRY_AFTER_MS).toISOString(),
      });
      if (error.kind !== 'rate_limited') {
        this.logger.warn(
          `Google Calendar sync failed for connection ${connection.id}: ${error.message}`,
        );
      }
      return 'retry';
    }
    await this.repo.finishSync(connection.id, {
      last_error: 'internal',
      sync_due_at: new Date(now.getTime() + RETRY_AFTER_MS).toISOString(),
    });
    throw error;
  }

  /**
   * The connection's refresh token, or null when this server's key can't open
   * it (sealed under a key since retired). Throws when there is no key at
   * all: that is the server's setup, not the connection, and the worker
   * doesn't run without one.
   */
  private openToken(connection: GoogleCalendarConnection): string | null {
    if (this.keyRing === null) {
      throw new Error('GOOGLE_CALENDAR_TOKEN_KEY is not set');
    }
    try {
      return openRefreshToken(
        this.keyRing,
        connection.refresh_token_sealed,
        connection.chapter_id,
        connection.user_id,
      );
    } catch {
      return null;
    }
  }
}

/** Reading Frapp's calendar back found it gone. */
class CalendarRemovedError extends Error {
  constructor() {
    super('Google Calendar: Frapp’s calendar was removed');
    this.name = 'CalendarRemovedError';
  }
}

function ignoreNotFound(error: unknown): void {
  if (error instanceof GoogleCalendarApiError && error.kind === 'not_found') {
    return;
  }
  throw error;
}
