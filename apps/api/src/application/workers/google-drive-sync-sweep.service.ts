import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import {
  CHAPTER_DRIVE_REPOSITORY,
  type IChapterDriveRepository,
} from '#domain/repositories/chapter-drive.repository.interface';
import {
  GoogleDriveSyncService,
  type DriveSyncOutcome,
} from '../services/google-drive/google-drive-sync.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** Folders taken per tick, across every chapter. */
export const GOOGLE_DRIVE_SYNC_BATCH = 6;
/** Folders synced at once within a tick. */
const CONCURRENCY = 2;
/**
 * How long a claimed folder is this replica's. Longer than a pass can take
 * (20 copies of up to 25 MB, each capped at 90 seconds, is the pathological
 * case), so two replicas never copy one folder at once.
 */
const LEASE_SECONDS = 45 * 60;

/**
 * Keeps chapters' connected Google Drive folders copied into Documents
 * (#5157; `spec/behavior/chapter-docs.md` § Google Drive folder).
 *
 * Every minute it claims the folders that are due (a new connection, Sync
 * now, a pass that left more to copy, or 15 minutes since the last) and the
 * disconnected ones waiting for their copies to be removed. The claim is a
 * leased compare-and-set in the database, so on several API replicas each
 * folder goes to one. Ticks on one replica don't overlap. While Google Drive
 * is switched off on this server (the key unset) it does nothing.
 */
@Injectable()
export class GoogleDriveSyncSweepService {
  private readonly logger = new Logger(GoogleDriveSyncSweepService.name);
  private running = false;

  constructor(
    @Inject(CHAPTER_DRIVE_REPOSITORY)
    private readonly repo: IChapterDriveRepository,
    private readonly sync: GoogleDriveSyncService,
  ) {}

  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleGoogleDriveSync(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } finally {
      this.running = false;
    }
  }

  async sweep(now: Date): Promise<Record<DriveSyncOutcome | 'error', number>> {
    const tally: Record<DriveSyncOutcome | 'error', number> = {
      synced: 0,
      more: 0,
      no_access: 0,
      rate_limited: 0,
      disconnected: 0,
      error: 0,
    };
    if (!this.sync.isAvailable()) return tally;
    const claimed = await this.repo.claim(
      now,
      GOOGLE_DRIVE_SYNC_BATCH,
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
            site: 'google-drive-sync',
            message: `Google Drive sync broke for connection ${next.id}; it is tried again in five minutes`,
            error,
          });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));
    return tally;
  }
}
