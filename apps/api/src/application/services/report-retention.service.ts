import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import {
  REPORTS_BUCKET,
  reportsFolderPrefix,
} from '../../domain/constants/storage';

/**
 * How long a generated report survives after it is written.
 *
 * Deliberately longer than `REPORT_URL_TTL_SECONDS` (1 hour), not equal to it.
 * The signed URL is dead after an hour, so anything past that is already
 * unreachable through the API — but a browser download that stalls, a retried
 * request, or a support conversation replaying an export all read the object
 * after its URL lapses, and 24h covers those without keeping a PII-bearing
 * snapshot around for a second day.
 */
export const REPORT_RETENTION_HOURS = 24;

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Reaping of generated report PDFs (`spec/behavior/data-retention.md`).
 *
 * Exports are **derived artifacts** — every one is regenerable from the source
 * tables it was rendered from — which is what makes deleting them safe, and is
 * the premise the whole service rests on. Nothing in the database references
 * these objects, so a delete here can never orphan a live row.
 *
 * Two callers, for two different reasons:
 *
 * - **The scheduled sweep** (`sweepExpiredReports`) bounds storage growth. The
 *   export key carries a random uuid so retries never overwrite, meaning the
 *   object count grows strictly with clicks.
 * - **Account deletion** (`purgeUserReports`) is the erasure guarantee. Roster
 *   exports embed member names, emails, roles, and join dates.
 *
 * The two overlap deliberately rather than one deferring to the other: the
 * sweep alone would leave a report exported minutes before an erasure request
 * holding that member's PII for up to `REPORT_RETENTION_HOURS`, and the
 * deletion sweep alone would never touch a chapter nobody has left.
 */
@Injectable()
export class ReportRetentionService {
  private readonly logger = new Logger(ReportRetentionService.name);

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  /**
   * Delete every report older than `REPORT_RETENTION_HOURS` across the given
   * chapters.
   *
   * Chapter IDs come from the caller because storage cannot supply them:
   * `listFiles`/`listObjects` return only the immediate folder level and drop
   * folder entries outright, so `chapters/` lists as empty and each chapter's
   * prefix has to be walked explicitly.
   *
   * Failure is isolated per chapter, matching the other sweeps — one chapter
   * whose prefix will not list must not stop the rest, and the next tick
   * retries it anyway since nothing here records progress.
   */
  async sweepExpiredReports(
    chapterIds: string[],
    now: Date,
  ): Promise<{ deleted: number }> {
    const cutoff = new Date(
      now.getTime() - REPORT_RETENTION_HOURS * MS_PER_HOUR,
    );
    let deleted = 0;

    for (const chapterId of chapterIds) {
      try {
        deleted += await this.deleteExpiredForChapter(chapterId, cutoff);
      } catch (error) {
        this.logger.error(
          `report retention sweep: chapter ${chapterId} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (deleted > 0) {
      this.logger.log(
        `report retention sweep: deleted ${deleted} expired report(s) across ${chapterIds.length} chapter(s)`,
      );
    }
    return { deleted };
  }

  /**
   * Delete every report belonging to the given chapters, regardless of age.
   *
   * This is the account-deletion sweep. A rendered PDF cannot have one member
   * surgically removed from it, and a chapter's roster/points/attendance
   * exports all carry the departing member's name — so the honest erasure is
   * to drop the chapter's whole report prefix and let officers re-export.
   *
   * Unlike the scheduled sweep this does **not** swallow failures: account
   * deletion promises the caller that PII is gone before it reports success,
   * so a listing or delete error has to surface and abort the flow.
   */
  async purgeUserReports(chapterIds: string[]): Promise<void> {
    for (const chapterId of new Set(chapterIds)) {
      await this.purgeChapterReports(chapterId);
    }
  }

  /**
   * Delete every report stored for one chapter.
   *
   * Also the entry point for chapter teardown — the point at which a chapter's
   * derived exports should stop existing. No chapter-deletion flow exists in
   * the API today (there is no `DELETE /v1/chapters/...` and no delete RPC), so
   * nothing calls it for that purpose yet; when one ships it calls this rather
   * than restating the prefix layout.
   */
  async purgeChapterReports(chapterId: string): Promise<number> {
    const paths = await this.storage.listFiles(
      REPORTS_BUCKET,
      reportsFolderPrefix(chapterId),
    );
    if (paths.length === 0) return 0;

    await this.storage.deleteFiles(REPORTS_BUCKET, paths);
    return paths.length;
  }

  /** Age-filtered delete for a single chapter's prefix. */
  private async deleteExpiredForChapter(
    chapterId: string,
    cutoff: Date,
  ): Promise<number> {
    const objects = await this.storage.listObjects(
      REPORTS_BUCKET,
      reportsFolderPrefix(chapterId),
    );

    const expired = objects
      // A null `createdAt` means the backend did not report one. Keeping the
      // object is the safe read: treating unknown as old would delete an
      // export the officer is still downloading, and the next tick re-checks
      // it for free once metadata is available.
      .filter(
        (object) => object.createdAt !== null && object.createdAt < cutoff,
      )
      .map((object) => object.path);

    if (expired.length === 0) return 0;

    await this.storage.deleteFiles(REPORTS_BUCKET, expired);
    return expired.length;
  }
}
