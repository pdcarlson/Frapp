import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import {
  CHAPTER_DRIVE_REPOSITORY,
  type IChapterDriveRepository,
} from '#domain/repositories/chapter-drive.repository.interface';
import {
  CHAPTER_DRIVE_LINK_REPOSITORY,
  type IChapterDriveLinkRepository,
} from '#domain/repositories/chapter-drive-link.repository.interface';
import {
  GoogleDriveSyncService,
  type DriveSyncOutcome,
} from '../services/google-drive/google-drive-sync.service';
import {
  GoogleDriveLinkService,
  type DriveLinkOutcome,
} from '../services/google-drive/google-drive-link.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** Folders taken per tick, across every chapter. */
export const GOOGLE_DRIVE_SYNC_BATCH = 6;
/** Folders synced at once within a tick. */
const CONCURRENCY = 2;
/**
 * Linked files checked per tick (#5434). A check is one metadata call, plus a
 * download only when the file changed, so far more fit in a tick than folders.
 */
export const GOOGLE_DRIVE_LINK_BATCH = 40;
/** Linked files checked at once within a tick. */
const LINK_CONCURRENCY = 4;
/**
 * A claimed link's lease. Longer than a tick's checks can take, so two replicas
 * never copy one file at once: 40 links over 4 workers is 10 checks each, and
 * one download is capped at 90 seconds.
 */
const LINK_LEASE_SECONDS = 30 * 60;
/**
 * How long a claimed folder is this replica's. Longer than a pass can take, so
 * two replicas never copy one folder at once: a pass stops listing folders at
 * 10 minutes (`DRIVE_LIST_TIME_MS`) and starts no copy after 25
 * (`DRIVE_COPY_TIME_MS`), and one copy is capped at 90 seconds.
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
  private runningLinks = false;

  constructor(
    @Inject(CHAPTER_DRIVE_REPOSITORY)
    private readonly repo: IChapterDriveRepository,
    private readonly sync: GoogleDriveSyncService,
    @Inject(CHAPTER_DRIVE_LINK_REPOSITORY)
    private readonly linkRepo: IChapterDriveLinkRepository,
    private readonly links: GoogleDriveLinkService,
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

  /**
   * Linked files tick on their own, so a long folder pass never holds up
   * their 15-minute checks or Sync now.
   */
  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleGoogleDriveLinkSync(): Promise<void> {
    if (this.runningLinks) return;
    this.runningLinks = true;
    try {
      await this.sweepLinks(new Date());
    } finally {
      this.runningLinks = false;
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

  /**
   * Files added by link (#5434): each due one is checked against Drive and
   * copied again when it changed. A link is due 15 minutes after its last
   * check, or at once after Sync now.
   */
  async sweepLinks(
    now: Date,
  ): Promise<Record<DriveLinkOutcome | 'error', number>> {
    const tally: Record<DriveLinkOutcome | 'error', number> = {
      unchanged: 0,
      updated: 0,
      no_access: 0,
      rate_limited: 0,
      kept: 0,
      gone: 0,
      error: 0,
    };
    if (!this.links.isAvailable()) return tally;
    const queue = await this.linkRepo.claim(
      now,
      GOOGLE_DRIVE_LINK_BATCH,
      LINK_LEASE_SECONDS,
    );
    const work = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          tally[await this.links.process(next, now)] += 1;
        } catch (error) {
          tally.error += 1;
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'google-drive-link-sync',
            message: `Google Drive link check broke for link ${next.id}; it is tried again in five minutes`,
            error,
          });
        }
      }
    };
    await Promise.all(Array.from({ length: LINK_CONCURRENCY }, work));
    return tally;
  }
}
