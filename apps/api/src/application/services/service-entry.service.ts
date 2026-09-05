import * as path from 'path';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  MAX_UPLOAD_LABEL,
} from '@repo/validation';
import { SERVICE_ENTRY_REPOSITORY } from '#domain/repositories/service-entry.repository.interface';
import type { IServiceEntryRepository } from '#domain/repositories/service-entry.repository.interface';
import type {
  ServiceEntry,
  ServiceEntryFilters,
  ServiceLeaderboardRow,
} from '#domain/entities/service-entry.entity';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import { NotificationService } from './notification.service';
import {
  ChapterWorkflowsService,
  WORKFLOW_HOURS_RECEIPT,
} from './chapter-workflows.service';
import { isUnsafeStoragePath } from '#domain/utils/storage-path';
import { ChapterServiceConfigService } from './chapter-service-config.service';

const SERVICE_BUCKET = 'service';

/**
 * Folder holding one chapter's service-proof uploads (trailing slash
 * included). chapterId is lowercased because storage prefix math is exact-
 * case while the guard's uuid authorization is not: a non-canonical
 * uppercase chapter id would otherwise mint a prefix that later validation
 * (running on the lowercase JWT-claim form) rejects.
 */
function serviceProofPrefix(chapterId: string): string {
  return `chapters/${chapterId.toLowerCase()}/service/`;
}

export interface CreateServiceEntryInput {
  chapter_id: string;
  user_id: string;
  date: string;
  duration_minutes: number;
  description: string;
  proof_path?: string | null;
}

export interface RequestProofUploadUrlInput {
  chapterId: string;
  filename: string;
  contentType: string;
  sizeBytes?: number;
}

export interface ReviewServiceEntryInput {
  status: 'APPROVED' | 'REJECTED';
  review_comment?: string | null;
}

@Injectable()
export class ServiceEntryService {
  constructor(
    @Inject(SERVICE_ENTRY_REPOSITORY)
    private readonly serviceEntryRepo: IServiceEntryRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    private readonly notificationService: NotificationService,
    private readonly chapterWorkflows: ChapterWorkflowsService,
    private readonly chapterServiceConfig: ChapterServiceConfigService,
  ) {}

  async requestProofUploadUrl(input: RequestProofUploadUrlInput): Promise<{
    signedUrl: string;
    storagePath: string;
    proofId: string;
  }> {
    const ext = input.filename.includes('.')
      ? input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase()
      : '';

    // Proof is images + PDF per spec/behavior/service-hours.md — kind "proof"
    // in @repo/validation; no office docs.
    if (!isAllowedUploadExtension('proof', ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!isAllowedUploadMime('proof', input.contentType)) {
      throw new BadRequestException(
        `Content type "${input.contentType}" is not allowed`,
      );
    }

    if (
      input.sizeBytes !== undefined &&
      !isWithinUploadSizeLimit(input.sizeBytes)
    ) {
      throw new BadRequestException(
        `File exceeds the ${MAX_UPLOAD_LABEL} upload limit`,
      );
    }

    // storage-api rejects keys with characters outside its ASCII allowed set
    // (accented letters, '#', '%', backslashes — which posix basename does
    // not strip), and the raw StorageApiError would surface as a 500. The
    // uuid folder already guarantees uniqueness; the filename is only for
    // reviewer readability, so squash anything unsafe to '_'.
    const safeFilename = path
      .basename(input.filename)
      .replace(/[^A-Za-z0-9._-]/g, '_');

    const proofId = crypto.randomUUID();
    const storagePath = `${serviceProofPrefix(input.chapterId)}${proofId}/${safeFilename}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      SERVICE_BUCKET,
      storagePath,
      input.contentType,
    );

    return { signedUrl, storagePath, proofId };
  }

  /**
   * Proof paths are client-echoed from the upload-url flow, so re-validate
   * server-side before persisting: the path must sit under the active
   * chapter's service-proof prefix (no `.`/`..`/empty segments, which would
   * let a prefix-passing string escape the folder) and must reference an
   * object that actually exists in storage — a fabricated key would otherwise
   * hand reviewers a proof link that can never resolve.
   */
  private async assertValidProofPath(
    chapterId: string,
    proofPath: string,
  ): Promise<void> {
    const prefix = serviceProofPrefix(chapterId);
    const segments = proofPath.split('/');
    if (
      !proofPath.startsWith(prefix) ||
      segments.some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      )
    ) {
      throw new BadRequestException(
        'proof_path must be a storage path within the chapter service-proof folder',
      );
    }
    // The literal-segment check above misses the percent-encoded and
    // control-character spellings, so run the shared helper too — this path is
    // then validated identically to the other confirm-upload flows. It runs
    // second so a plainly wrong path keeps its more helpful message.
    if (isUnsafeStoragePath(proofPath)) {
      throw new BadRequestException(
        'proof_path must not contain relative path segments',
      );
    }

    const folder = proofPath.slice(0, proofPath.lastIndexOf('/'));
    const uploaded = await this.storageProvider.listFiles(
      SERVICE_BUCKET,
      folder,
    );
    if (!uploaded.includes(proofPath)) {
      throw new BadRequestException(
        'proof_path does not reference an uploaded proof file',
      );
    }
  }

  async getProofDownloadUrl(
    id: string,
    chapterId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<{ url: string }> {
    const entry = await this.findById(id, chapterId);

    if (!isAdmin && entry.user_id !== userId) {
      throw new ForbiddenException(
        'You can only access proof for your own service entries',
      );
    }

    if (!entry.proof_path) {
      throw new NotFoundException('Service entry has no proof file');
    }

    // Rows created before proof validation existed can hold arbitrary text
    // (external URLs, guessed keys, other chapters' paths). Never sign
    // anything outside this chapter's service-proof prefix.
    if (!entry.proof_path.startsWith(serviceProofPrefix(chapterId))) {
      throw new NotFoundException('Proof file is not available for download');
    }

    try {
      const url = await this.storageProvider.getSignedDownloadUrl(
        SERVICE_BUCKET,
        entry.proof_path,
      );
      return { url };
    } catch (error) {
      // Legacy rows can hold prefix-shaped paths whose object was never
      // uploaded (the old UI accepted free text verbatim); a missing object
      // is a 404 for the caller, not a server fault. Anything else (outage,
      // bad credentials) must stay a 5xx so monitoring sees it.
      if (/not.?found/i.test(String((error as Error)?.message))) {
        throw new NotFoundException('Proof file is not available for download');
      }
      throw error;
    }
  }

  async findById(id: string, chapterId: string): Promise<ServiceEntry> {
    const entry = await this.serviceEntryRepo.findById(id, chapterId);
    if (!entry) {
      throw new NotFoundException('Service entry not found');
    }
    return entry;
  }

  /**
   * Admin queue read with optional status / date-range / member filters
   * (spec/behavior/service-hours.md → Visibility). Filtering happens in SQL, so
   * a chapter with years of history doesn't stream every row into Node to throw
   * most of them away.
   */
  async findByChapterFiltered(
    chapterId: string,
    filters: ServiceEntryFilters,
  ): Promise<ServiceEntry[]> {
    this.assertValidDateRange(filters.startDate, filters.endDate);
    return this.serviceEntryRepo.findByChapterFiltered(chapterId, filters);
  }

  /**
   * Chapter-wide leaderboard of approved service time, visible to any member
   * who can view the roster (spec: "Members see ... a chapter-wide service
   * leaderboard").
   */
  async leaderboard(
    chapterId: string,
    range: { startDate?: string; endDate?: string } = {},
  ): Promise<ServiceLeaderboardRow[]> {
    this.assertValidDateRange(range.startDate, range.endDate);
    return this.serviceEntryRepo.leaderboard(chapterId, range);
  }

  /**
   * Rejects malformed or inverted ranges up front. Postgres would accept an
   * inverted range happily and return zero rows, which reads as "this member
   * logged nothing" rather than "your filter is backwards".
   *
   * The format is pinned to `YYYY-MM-DD` rather than "anything `new Date()`
   * accepts", for two reasons:
   *
   *  - `Date` accepts `2026-02-30` and silently rolls it to March 2, but the
   *    `date` column does not — an unpinned check would pass it through to
   *    PostgREST and surface as a 500 instead of a 400.
   *  - Comparing the bounds needs a total order. Zero-padded ISO dates compare
   *    correctly as strings, but a legacy spelling like `2026-3-1` does not
   *    (`'2026-3-1' > '2026-12-01'` is true), which would 400 a perfectly
   *    valid March-to-December range. Both bounds are parsed and compared as
   *    timestamps instead.
   */
  private assertValidDateRange(startDate?: string, endDate?: string): void {
    const parsed: Record<'start_date' | 'end_date', number | null> = {
      start_date: null,
      end_date: null,
    };

    for (const [label, value] of [
      ['start_date', startDate],
      ['end_date', endDate],
    ] as const) {
      if (value === undefined) continue;

      const time = Date.parse(`${value}T00:00:00Z`);
      // The round-trip is what rejects a real-looking but nonexistent day:
      // `2026-02-30` parses, then serializes back as `2026-03-02`.
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(time) ||
        new Date(time).toISOString().slice(0, 10) !== value
      ) {
        throw new BadRequestException(
          `${label} must be a valid YYYY-MM-DD date`,
        );
      }
      parsed[label] = time;
    }

    if (
      parsed.start_date !== null &&
      parsed.end_date !== null &&
      parsed.start_date > parsed.end_date
    ) {
      throw new BadRequestException('start_date must not be after end_date');
    }
  }

  async create(input: CreateServiceEntryInput): Promise<ServiceEntry> {
    const { date, duration_minutes, description } = input;

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException('date must be a valid ISO date');
    }

    if (
      typeof duration_minutes !== 'number' ||
      duration_minutes < 1 ||
      !Number.isInteger(duration_minutes)
    ) {
      throw new BadRequestException(
        'duration_minutes must be a positive integer',
      );
    }

    if (
      !description ||
      typeof description !== 'string' ||
      !description.trim()
    ) {
      throw new BadRequestException('description is required');
    }

    // Whitespace-only proof must not satisfy the receipt policy below (or be
    // stored as a "proof" the review queue can't render).
    const proofPath = input.proof_path?.trim() || null;

    // Chapter policy (Settings → Workflows): wf_hours_receipt makes proof
    // mandatory at submission. Legacy proof-less entries stay approvable at
    // the reviewer's discretion. Only consulted when proof is absent — a
    // submission with proof satisfies the policy either way.
    if (!proofPath) {
      const receiptPolicy = await this.chapterWorkflows.getWorkflow(
        input.chapter_id,
        WORKFLOW_HOURS_RECEIPT,
      );
      if (receiptPolicy.enabled) {
        throw new BadRequestException(
          'This chapter requires a receipt (photo or signed slip) with service-hour submissions — attach proof and resubmit',
        );
      }
    } else {
      await this.assertValidProofPath(input.chapter_id, proofPath);
    }

    return this.serviceEntryRepo.create({
      chapter_id: input.chapter_id,
      user_id: input.user_id,
      date: input.date,
      duration_minutes,
      description: description.trim(),
      proof_path: proofPath,
      status: 'PENDING',
      reviewed_by: null,
      review_comment: null,
      points_awarded: false,
    });
  }

  async approve(
    id: string,
    chapterId: string,
    reviewerId: string,
    reviewComment?: string | null,
  ): Promise<ServiceEntry> {
    const entry = await this.findById(id, chapterId);

    // Approving awards SERVICE points to the entry's submitter, so a holder of
    // `service:approve` approving their own entry moves their own balance with
    // no second party. `PointsService.adjustPoints:215` already refuses the
    // equivalent, and `TaskService.confirmCompletion:294` closed the same gap on
    // the task path (#1056). The rule this implements is `points.md`'s "No
    // self-award" bullet, which binds the **ledger** rather than one endpoint;
    // service-hour approval was the last award path on which the member who
    // earns can also authorise.
    //
    // Ordered before the status guard deliberately, matching #1056: which
    // refusal a caller sees must not depend on what state their own entry
    // happens to be in, and an authorization failure is the more fundamental of
    // the two. It stays above `approveAtomic`, so the RPC's compare-and-set
    // concurrency guarantee is untouched.
    if (entry.user_id === reviewerId) {
      throw new ForbiddenException(
        'Admins cannot approve their own service entries',
      );
    }

    if (entry.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING entries can be approved');
    }

    if (entry.points_awarded) {
      throw new BadRequestException('Points already awarded for this entry');
    }

    // Chapter policy (Settings → Service): how many minutes of approved
    // service earn one SERVICE point. An unconfigured chapter reports the
    // default 60, which is the rate this service hardcoded before the rate
    // became configurable — so behavior is unchanged until a chapter opts in.
    // Read at approval time, not at submission, so raising the rate mid-review
    // applies to everything still in the queue.
    const minutesPerPoint =
      await this.chapterServiceConfig.getMinutesPerPoint(chapterId);

    // Sub-rate durations floor to 0 and approve with no ledger row, per the
    // spec's "(Sub-rate durations approve with no ledger row.)"
    const pointsToAward = Math.floor(entry.duration_minutes / minutesPerPoint);

    // Approve the entry and award its SERVICE points atomically: a single DB
    // transaction (compare-and-set on status/points_awarded) so a partial
    // failure can't award points while leaving the entry PENDING, and concurrent
    // approvals can't double-insert the ledger row. The guards above are a
    // friendly fast path; the RPC's conditional update is the authoritative
    // concurrency guard. Returns null when nothing was updated: the entry is no
    // longer PENDING or points were already awarded (race lost) between the
    // fast-path read and the RPC.
    const updated = await this.serviceEntryRepo.approveAtomic(
      id,
      chapterId,
      reviewerId,
      reviewComment ?? null,
      pointsToAward,
    );
    if (!updated) {
      throw new BadRequestException(
        'Service entry approval failed — entry is no longer eligible or points were already awarded',
      );
    }

    try {
      await this.notificationService.notifyUser(entry.user_id, chapterId, {
        title: 'Service Hours Approved',
        body: `Your service entry "${entry.description}" has been approved`,
        priority: 'NORMAL',
        category: 'service',
        data: { target: { screen: 'service' } },
      });
    } catch {}

    return updated;
  }

  async reject(
    id: string,
    chapterId: string,
    reviewerId: string,
    reviewComment?: string | null,
  ): Promise<ServiceEntry> {
    const entry = await this.findById(id, chapterId);

    if (entry.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING entries can be rejected');
    }

    const updated = await this.serviceEntryRepo.update(id, chapterId, {
      status: 'REJECTED',
      reviewed_by: reviewerId,
      review_comment: reviewComment ?? null,
    });

    try {
      await this.notificationService.notifyUser(entry.user_id, chapterId, {
        title: 'Service Hours Rejected',
        body: reviewComment
          ? `Your service entry "${entry.description}" has been rejected: ${reviewComment}`
          : `Your service entry "${entry.description}" has been rejected`,
        priority: 'NORMAL',
        category: 'service',
        data: { target: { screen: 'service' } },
      });
    } catch {}

    return updated;
  }

  async delete(
    id: string,
    chapterId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<void> {
    const entry = await this.findById(id, chapterId);

    if (entry.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING entries can be deleted');
    }

    if (!isAdmin && entry.user_id !== userId) {
      throw new ForbiddenException(
        'You can only delete your own service entries',
      );
    }

    // Purge the proof object with the row (file-first, matching Backwork and
    // chapter documents) so deleted entries don't orphan personal photos in
    // the private bucket. Legacy free-text paths never reference an object
    // this chapter owns, so only prefix-valid paths are deleted.
    if (entry.proof_path?.startsWith(serviceProofPrefix(chapterId))) {
      await this.storageProvider.deleteFile(SERVICE_BUCKET, entry.proof_path);
    }

    await this.serviceEntryRepo.delete(id, chapterId);
  }
}
