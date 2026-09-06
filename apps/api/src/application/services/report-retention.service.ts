import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
  type StorageObject,
} from '#domain/adapters/storage.interface';
import {
  REPORTS_BUCKET,
  REPORTS_ROOT_PREFIX,
  reportsFolderPrefix,
} from '#domain/constants/storage';

/**
 * How long a generated report survives after it is written.
 *
 * Deliberately longer than `REPORT_URL_TTL_SECONDS` (1 hour), not equal to it.
 * The signed URL is dead after an hour, so anything past that is already
 * unreachable through the API — but a browser download that stalls, a retried
 * request, or a support conversation replaying an export all read the object
 * after its URL lapses, and 24h covers those without keeping a PII-bearing
 * snapshot around for a second day.
 *
 * `spec/behavior/reports.md` states this number to users. A test pins it, so
 * changing it here fails until the spec is changed too.
 */
export const REPORT_RETENTION_HOURS = 24;

const MS_PER_HOUR = 60 * 60 * 1000;

/** What one sweep did, for logging and tests. */
export interface ReportSweepResult {
  deleted: number;
  /** Chapter prefixes whose listing or delete threw and were skipped. */
  failed: number;
}

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
 * - **Account deletion** (`purgeUserReports`) makes erasure prompt. Roster
 *   exports embed member names, emails, roles, and join dates.
 *
 * The two overlap deliberately rather than one deferring to the other, and
 * **neither is absolute on its own** — a point the specs state plainly rather
 * than rounding off. The sweep alone would leave a report exported minutes
 * before an erasure request holding that member's PII for up to
 * `REPORT_RETENTION_HOURS`; it also keeps objects whose stored-at timestamp
 * the backend never reported, and skips prefixes it cannot read. The deletion
 * purge alone reaches only the chapters that member is currently in, and its
 * caller treats a failure as non-fatal. Together they cover each other's gaps
 * in the ordinary case; `spec/behavior/data-retention.md` documents the
 * residue that survives both.
 */
@Injectable()
export class ReportRetentionService {
  private readonly logger = new Logger(ReportRetentionService.name);

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  /**
   * Delete every report older than `REPORT_RETENTION_HOURS`, across every
   * chapter prefix that currently holds one.
   *
   * The work list comes from storage itself (`REPORTS_ROOT_PREFIX`), not from
   * the `chapters` table. That matters three ways: the cost scales with
   * chapters that have *exported*, not with chapters that exist; a prefix
   * outlives its `chapters` row and still gets reaped; and there is no DB read
   * whose failure could be mistaken for "nothing to do".
   *
   * Failure is isolated per chapter, matching the other sweeps — one chapter
   * whose prefix will not list must not stop the rest, and the next tick
   * retries it anyway since nothing here records progress.
   */
  async sweepExpiredReports(now: Date): Promise<ReportSweepResult> {
    const cutoff = new Date(
      now.getTime() - REPORT_RETENTION_HOURS * MS_PER_HOUR,
    );

    const chapterIds = await this.storage.listFolders(
      REPORTS_BUCKET,
      REPORTS_ROOT_PREFIX,
    );

    // An empty work list is reported, not passed over in silence. The storage
    // layer treats a missing bucket as an empty folder — deliberately, so a
    // never-provisioned environment does not break account deletion — which
    // means an unprovisioned, renamed, or wrongly-configured `reports` bucket
    // reaches here as "nothing to reap" and would otherwise skip every log
    // below. That is the single most likely way this sweep stops working, and
    // it is exactly the case where the bucket grows PII without bound.
    if (chapterIds.length === 0) {
      this.logger.log(
        `report retention sweep: no chapter prefixes under ${REPORTS_BUCKET}/${REPORTS_ROOT_PREFIX} — nothing has been exported, or the bucket is not provisioned`,
      );
      return { deleted: 0, failed: 0 };
    }

    let deleted = 0;
    let failed = 0;
    let unknownAge = 0;

    for (const chapterId of chapterIds) {
      try {
        const objects = await this.listChapterReports(chapterId);
        unknownAge += objects.filter(
          (object) => object.createdAt === null,
        ).length;
        deleted += await this.deleteObjects(
          objects.filter((object) => this.isExpired(object, cutoff)),
        );
      } catch (error) {
        failed += 1;
        this.logger.error(
          `report retention sweep: chapter ${chapterId} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    // Logged unconditionally when anything went wrong, because the sweep's
    // guarantee is stated as a hard 24h bound in spec/behavior/reports.md. A
    // sweep that silently reaps nothing forever — every prefix erroring, or
    // every object missing its timestamp — would otherwise look exactly like a
    // healthy sweep with nothing to do.
    if (failed > 0) {
      this.logger.warn(
        `report retention sweep: ${failed}/${chapterIds.length} chapter prefixes failed and were skipped`,
      );
    }
    if (unknownAge > 0) {
      this.logger.warn(
        `report retention sweep: ${unknownAge} report(s) have no stored-at timestamp and cannot be aged out; they will be retained until account deletion or a manual purge removes them`,
      );
    }
    if (deleted > 0) {
      this.logger.log(
        `report retention sweep: deleted ${deleted} expired report(s) across ${chapterIds.length} chapter prefix(es)`,
      );
    }

    return { deleted, failed };
  }

  /**
   * Delete every report belonging to the given chapters, regardless of age.
   *
   * This is the account-deletion sweep. A rendered PDF cannot have one member
   * surgically removed from it, and a chapter's roster/points/attendance
   * exports all carry the departing member's name — so the honest erasure is
   * to drop the chapter's whole report prefix and let officers re-export.
   *
   * Every chapter is attempted even when an earlier one fails, and the
   * failures are then raised together. Fail-fast would be actively harmful
   * here: the caller logs and continues rather than retrying (see
   * `AccountDeletionService`), so aborting at the first bad prefix would
   * silently skip every chapter after it — the erased user's PII left sitting
   * in chapters nothing ever revisited. Attempt-all-then-throw keeps the
   * failure visible without letting it truncate the work.
   */
  async purgeUserReports(chapterIds: string[]): Promise<void> {
    const failures: string[] = [];

    for (const chapterId of new Set(chapterIds)) {
      try {
        await this.purgeChapterReports(chapterId);
      } catch (error) {
        failures.push(chapterId);
        this.logger.error(
          `report purge: chapter ${chapterId} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Report purge failed for chapter(s): ${failures.join(', ')}`,
      );
    }
  }

  /**
   * Delete every report stored for one chapter.
   *
   * Also the entry point for chapter teardown — the point at which a chapter's
   * derived exports should stop existing. No chapter-deletion flow exists in
   * the API today (there is no `DELETE /v1/chapters/...` and no delete RPC), so
   * nothing calls it for that purpose yet; when one ships it calls this rather
   * than restating the prefix layout. A chapter torn down without it is not
   * stranded either — the sweep walks storage, so the orphaned prefix is still
   * reaped on age.
   */
  async purgeChapterReports(chapterId: string): Promise<number> {
    // No age filter: erasure must also remove objects the sweep cannot age
    // out (an unknown `createdAt`), which are otherwise the ones that survive
    // longest.
    return this.deleteObjects(await this.listChapterReports(chapterId));
  }

  /** Every object under one chapter's report prefix. */
  private listChapterReports(chapterId: string): Promise<StorageObject[]> {
    return this.storage.listObjects(
      REPORTS_BUCKET,
      reportsFolderPrefix(chapterId),
    );
  }

  /**
   * Delete an already-listed set of objects.
   *
   * Both purges funnel through here so a guard added for one — a batch cap, a
   * key-shape filter — reaches the other. Splitting them is how the scheduled
   * sweep and the erasure path drift invisibly with both suites still green.
   */
  private async deleteObjects(objects: StorageObject[]): Promise<number> {
    if (objects.length === 0) return 0;

    await this.storage.deleteFiles(
      REPORTS_BUCKET,
      objects.map((object) => object.path),
    );
    return objects.length;
  }

  /**
   * Past the retention window.
   *
   * A null `createdAt` means the backend did not report one. Keeping the
   * object is the safe read: treating unknown as old would delete an export
   * the officer is still downloading. The caller counts these and warns, so an
   * age filter that can never fire is visible rather than silent.
   */
  private isExpired(object: StorageObject, cutoff: Date): boolean {
    return object.createdAt !== null && object.createdAt < cutoff;
  }
}
