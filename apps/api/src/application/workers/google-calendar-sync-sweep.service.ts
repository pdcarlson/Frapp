import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import {
  GOOGLE_CALENDAR_REPOSITORY,
  type IGoogleCalendarRepository,
} from '#domain/repositories/google-calendar.repository.interface';
import {
  GoogleCalendarSyncService,
  type GoogleSyncOutcome,
} from '../services/google-calendar/google-calendar-sync.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { toReportableError } from '../../infrastructure/observability/reportable-error';

/** Connections taken per tick, across every chapter. */
export const GOOGLE_SYNC_BATCH = 12;
/** Connections synced at once within a tick. */
const CONCURRENCY = 3;
/**
 * How long a claimed connection is this replica's. Longer than a sync can
 * take (a write budget of 100 calls, each capped at 10 seconds, is the
 * pathological case), so two replicas never write one calendar at once.
 */
const LEASE_SECONDS = 20 * 60;
/** Sign-ins kept this long after they expire, then dropped. */
const STATE_KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps members' Google Calendars up to date (#3322, step 2;
 * `spec/behavior/events.md` § Google Calendar).
 *
 * Every minute it claims the connections that are due (a new connection, a
 * chapter whose events or tasks changed, which the database's triggers mark,
 * or fifteen minutes since the last sync) and the ones waiting to be cleaned
 * up after a disconnect, and works through them a few at a time. The claim is
 * a leased compare-and-set in the database, so on several API replicas each
 * connection goes to one. Ticks on one replica don't overlap. A tick in which
 * some syncs failed reports it, so a fault that fails every sync is seen.
 */
@Injectable()
export class GoogleCalendarSyncSweepService {
  private readonly logger = new Logger(GoogleCalendarSyncSweepService.name);
  private running = false;

  constructor(
    @Inject(GOOGLE_CALENDAR_REPOSITORY)
    private readonly repo: IGoogleCalendarRepository,
    private readonly sync: GoogleCalendarSyncService,
  ) {}

  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleGoogleCalendarSync(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } finally {
      this.running = false;
    }
  }

  async sweep(now: Date): Promise<Record<GoogleSyncOutcome | 'error', number>> {
    const tally: Record<GoogleSyncOutcome | 'error', number> = {
      synced: 0,
      more: 0,
      needs_reconnect: 0,
      calendar_removed: 0,
      retry: 0,
      skipped: 0,
      error: 0,
    };
    const claimed = await this.repo.claim(
      now,
      GOOGLE_SYNC_BATCH,
      LEASE_SECONDS,
    );
    const queue = [...claimed];
    const work = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          tally[await this.sync.process(next, now)] += 1;
        } catch (error) {
          tally.error += 1;
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'google-calendar-sync',
            message: `Google Calendar sync broke for connection ${next.id}; it is tried again in five minutes`,
            error,
          });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));

    if (tally.retry > 0) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'google-calendar-sync-google',
        message: `Google refused or failed ${tally.retry} of ${claimed.length} Google Calendar sync(s); each is tried again in five minutes`,
      });
    }

    await this.repo
      .deleteExpiredStates(new Date(now.getTime() - STATE_KEEP_MS))
      .catch((error: unknown) =>
        this.logger.warn(
          `Could not drop expired Google sign-ins: ${toReportableError(error).message}`,
        ),
      );
    return tally;
  }
}
