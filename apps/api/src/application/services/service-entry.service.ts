import * as path from 'path';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SERVICE_ENTRY_REPOSITORY } from '../../domain/repositories/service-entry.repository.interface';
import type { IServiceEntryRepository } from '../../domain/repositories/service-entry.repository.interface';
import type { ServiceEntry } from '../../domain/entities/service-entry.entity';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import { NotificationService } from './notification.service';
import {
  ChapterWorkflowsService,
  WORKFLOW_HOURS_RECEIPT,
} from './chapter-workflows.service';

/** Default: 1 point per 60 minutes of service. Chapter-configurable in future. */
const DEFAULT_MINUTES_PER_POINT = 60;

const SERVICE_BUCKET = 'service';

/** Proof is "photo, PDF, etc." per spec/behavior/service-hours.md — no office docs. */
const ALLOWED_PROOF_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

const ALLOWED_PROOF_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
]);

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
  ) {}

  async requestProofUploadUrl(input: RequestProofUploadUrlInput): Promise<{
    signedUrl: string;
    storagePath: string;
    proofId: string;
  }> {
    const ext = input.filename.includes('.')
      ? input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!ALLOWED_PROOF_EXTENSIONS.has(ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!ALLOWED_PROOF_CONTENT_TYPES.has(input.contentType)) {
      throw new BadRequestException(
        `Content type "${input.contentType}" is not allowed`,
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

  async findByChapter(chapterId: string): Promise<ServiceEntry[]> {
    return this.serviceEntryRepo.findByChapter(chapterId);
  }

  async findByUser(chapterId: string, userId: string): Promise<ServiceEntry[]> {
    return this.serviceEntryRepo.findByUser(chapterId, userId);
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

    if (entry.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING entries can be approved');
    }

    if (entry.points_awarded) {
      throw new BadRequestException('Points already awarded for this entry');
    }

    const pointsToAward = Math.floor(
      entry.duration_minutes / DEFAULT_MINUTES_PER_POINT,
    );

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
        body: `Your service entry "${entry.description}" has been rejected`,
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
