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
import { NotificationService } from './notification.service';
import {
  ChapterWorkflowsService,
  WORKFLOW_HOURS_RECEIPT,
} from './chapter-workflows.service';

/** Default: 1 point per 60 minutes of service. Chapter-configurable in future. */
const DEFAULT_MINUTES_PER_POINT = 60;

export interface CreateServiceEntryInput {
  chapter_id: string;
  user_id: string;
  date: string;
  duration_minutes: number;
  description: string;
  proof_path?: string | null;
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
    private readonly notificationService: NotificationService,
    private readonly chapterWorkflows: ChapterWorkflowsService,
  ) {}

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

    // Chapter policy (Settings → Workflows): wf_hours_receipt makes proof
    // mandatory at submission. Legacy proof-less entries stay approvable at
    // the reviewer's discretion.
    const receiptPolicy = await this.chapterWorkflows.getWorkflow(
      input.chapter_id,
      WORKFLOW_HOURS_RECEIPT,
    );
    if (receiptPolicy.enabled && !input.proof_path) {
      throw new BadRequestException(
        'This chapter requires a receipt (photo or signed slip) with service-hour submissions — attach proof and resubmit',
      );
    }

    return this.serviceEntryRepo.create({
      chapter_id: input.chapter_id,
      user_id: input.user_id,
      date: input.date,
      duration_minutes,
      description: description.trim(),
      proof_path: input.proof_path ?? null,
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

    await this.serviceEntryRepo.delete(id, chapterId);
  }
}
