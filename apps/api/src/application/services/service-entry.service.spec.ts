import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ServiceEntryService } from './service-entry.service';
import { SERVICE_ENTRY_REPOSITORY } from '../../domain/repositories/service-entry.repository.interface';
import type { IServiceEntryRepository } from '../../domain/repositories/service-entry.repository.interface';
import type { ServiceEntry } from '../../domain/entities/service-entry.entity';
import { NotificationService } from './notification.service';
import {
  ChapterWorkflowsService,
  WORKFLOW_HOURS_RECEIPT,
} from './chapter-workflows.service';

describe('ServiceEntryService', () => {
  let service: ServiceEntryService;
  let mockServiceEntryRepo: jest.Mocked<IServiceEntryRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockChapterWorkflows: jest.Mocked<
    Pick<ChapterWorkflowsService, 'getWorkflow'>
  >;

  const receiptWorkflow = (enabled: boolean) => ({
    key: WORKFLOW_HOURS_RECEIPT,
    enabled,
    threshold: null,
  });

  const baseEntry: ServiceEntry = {
    id: 'se-1',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    date: '2026-02-26',
    duration_minutes: 60,
    description: 'Community cleanup',
    proof_path: null,
    status: 'PENDING',
    reviewed_by: null,
    review_comment: null,
    points_awarded: false,
    created_at: '2026-02-26T10:00:00.000Z',
  };

  beforeEach(async () => {
    mockServiceEntryRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByUser: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      approveAtomic: jest.fn(),
      delete: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    // Default: the receipt workflow is disabled so the base create cases
    // exercise the no-policy path; enforcement cases override per test.
    mockChapterWorkflows = {
      getWorkflow: jest.fn().mockResolvedValue(receiptWorkflow(false)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceEntryService,
        { provide: SERVICE_ENTRY_REPOSITORY, useValue: mockServiceEntryRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: ChapterWorkflowsService, useValue: mockChapterWorkflows },
      ],
    }).compile();

    service = module.get(ServiceEntryService);
  });

  describe('findById', () => {
    it('should return entry when found', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);

      const result = await service.findById('se-1', 'ch-1');

      expect(mockServiceEntryRepo.findById).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
      );
      expect(result).toEqual(baseEntry);
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(null);

      await expect(service.findById('se-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById('se-1', 'ch-1')).rejects.toThrow(
        'Service entry not found',
      );
    });
  });

  describe('findByChapter', () => {
    it('should return all entries for chapter', async () => {
      mockServiceEntryRepo.findByChapter.mockResolvedValue([baseEntry]);

      const result = await service.findByChapter('ch-1');

      expect(mockServiceEntryRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(result).toEqual([baseEntry]);
    });
  });

  describe('findByUser', () => {
    it('should return entries for user', async () => {
      mockServiceEntryRepo.findByUser.mockResolvedValue([baseEntry]);

      const result = await service.findByUser('ch-1', 'user-1');

      expect(mockServiceEntryRepo.findByUser).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(result).toEqual([baseEntry]);
    });
  });

  describe('create', () => {
    it('should create entry with PENDING status', async () => {
      mockServiceEntryRepo.create.mockResolvedValue(baseEntry);

      const result = await service.create({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        date: '2026-02-26',
        duration_minutes: 60,
        description: 'Community cleanup',
      });

      expect(mockServiceEntryRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        date: '2026-02-26',
        duration_minutes: 60,
        description: 'Community cleanup',
        proof_path: null,
        status: 'PENDING',
        reviewed_by: null,
        review_comment: null,
        points_awarded: false,
      });
      expect(result).toEqual(baseEntry);
    });

    it('should create entry with optional proof_path', async () => {
      const withProof = {
        ...baseEntry,
        proof_path: 'chapters/ch-1/service/se-1/proof.pdf',
      };
      mockServiceEntryRepo.create.mockResolvedValue(withProof);

      await service.create({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        date: '2026-02-26',
        duration_minutes: 30,
        description: 'Volunteer work',
        proof_path: 'chapters/ch-1/service/se-1/proof.pdf',
      });

      expect(mockServiceEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          proof_path: 'chapters/ch-1/service/se-1/proof.pdf',
        }),
      );
    });

    it('should throw BadRequestException for invalid date', async () => {
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: 'invalid-date',
          duration_minutes: 60,
          description: 'Test',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: 'invalid-date',
          duration_minutes: 60,
          description: 'Test',
        }),
      ).rejects.toThrow('date must be a valid ISO date');
      expect(mockServiceEntryRepo.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid duration_minutes', async () => {
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: '2026-02-26',
          duration_minutes: 0,
          description: 'Test',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: '2026-02-26',
          duration_minutes: -1,
          description: 'Test',
        }),
      ).rejects.toThrow('duration_minutes must be a positive integer');
      expect(mockServiceEntryRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a proof-less submission when wf_hours_receipt is enabled', async () => {
      mockChapterWorkflows.getWorkflow.mockResolvedValue(receiptWorkflow(true));

      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: '2026-02-26',
          duration_minutes: 60,
          description: 'Community cleanup',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: '2026-02-26',
          duration_minutes: 60,
          description: 'Community cleanup',
        }),
      ).rejects.toThrow(/requires a receipt/);
      expect(mockChapterWorkflows.getWorkflow).toHaveBeenCalledWith(
        'ch-1',
        WORKFLOW_HOURS_RECEIPT,
      );
      expect(mockServiceEntryRepo.create).not.toHaveBeenCalled();
    });

    it('should accept a submission with proof when wf_hours_receipt is enabled', async () => {
      mockChapterWorkflows.getWorkflow.mockResolvedValue(receiptWorkflow(true));
      const withProof = {
        ...baseEntry,
        proof_path: 'chapters/ch-1/service/se-1/proof.pdf',
      };
      mockServiceEntryRepo.create.mockResolvedValue(withProof);

      await service.create({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        date: '2026-02-26',
        duration_minutes: 60,
        description: 'Community cleanup',
        proof_path: 'chapters/ch-1/service/se-1/proof.pdf',
      });

      expect(mockServiceEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          proof_path: 'chapters/ch-1/service/se-1/proof.pdf',
        }),
      );
      // Proof satisfies the policy regardless of the toggle, so the lookup
      // is skipped entirely on this path.
      expect(mockChapterWorkflows.getWorkflow).not.toHaveBeenCalled();
    });

    it('should reject whitespace-only proof when wf_hours_receipt is enabled', async () => {
      mockChapterWorkflows.getWorkflow.mockResolvedValue(receiptWorkflow(true));

      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: '2026-02-26',
          duration_minutes: 60,
          description: 'Community cleanup',
          proof_path: '   ',
        }),
      ).rejects.toThrow(/requires a receipt/);
      expect(mockServiceEntryRepo.create).not.toHaveBeenCalled();
    });

    it('should store trimmed proof and normalize whitespace-only proof to null', async () => {
      mockServiceEntryRepo.create.mockResolvedValue(baseEntry);

      await service.create({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        date: '2026-02-26',
        duration_minutes: 60,
        description: 'Community cleanup',
        proof_path: '  chapters/ch-1/service/se-1/proof.pdf  ',
      });

      expect(mockServiceEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          proof_path: 'chapters/ch-1/service/se-1/proof.pdf',
        }),
      );
    });

    it('should accept a proof-less submission when wf_hours_receipt is disabled', async () => {
      mockChapterWorkflows.getWorkflow.mockResolvedValue(
        receiptWorkflow(false),
      );
      mockServiceEntryRepo.create.mockResolvedValue(baseEntry);

      await service.create({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        date: '2026-02-26',
        duration_minutes: 60,
        description: 'Community cleanup',
      });

      expect(mockServiceEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ proof_path: null }),
      );
    });

    it('should throw BadRequestException for empty description', async () => {
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: '2026-02-26',
          duration_minutes: 60,
          description: '',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: '2026-02-26',
          duration_minutes: 60,
          description: '   ',
        }),
      ).rejects.toThrow('description is required');
      expect(mockServiceEntryRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('should approve entry and award points in a single atomic call', async () => {
      const approved = {
        ...baseEntry,
        status: 'APPROVED' as const,
        reviewed_by: 'admin-1',
        review_comment: null,
        points_awarded: true,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);
      mockServiceEntryRepo.approveAtomic.mockResolvedValue(approved);

      const result = await service.approve('se-1', 'ch-1', 'admin-1', null);

      // Approval + ledger insert happen together inside the RPC (1 point for
      // 60 minutes); the service must not perform a separate non-atomic update.
      expect(mockServiceEntryRepo.approveAtomic).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
        'admin-1',
        null,
        1,
      );
      expect(mockServiceEntryRepo.update).not.toHaveBeenCalled();
      expect(result).toEqual(approved);
    });

    it('should pass the computed multi-point award for longer duration', async () => {
      const longEntry = { ...baseEntry, duration_minutes: 120 };
      const approved = {
        ...longEntry,
        status: 'APPROVED' as const,
        reviewed_by: 'admin-1',
        points_awarded: true,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(longEntry);
      mockServiceEntryRepo.approveAtomic.mockResolvedValue(approved);

      await service.approve('se-1', 'ch-1', 'admin-1', null);

      expect(mockServiceEntryRepo.approveAtomic).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
        'admin-1',
        null,
        2,
      );
    });

    it('should approve with zero points when duration is below the rate', async () => {
      const shortEntry = { ...baseEntry, duration_minutes: 30 };
      const approved = {
        ...shortEntry,
        status: 'APPROVED' as const,
        reviewed_by: 'admin-1',
        points_awarded: false,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(shortEntry);
      mockServiceEntryRepo.approveAtomic.mockResolvedValue(approved);

      const result = await service.approve('se-1', 'ch-1', 'admin-1', null);

      expect(mockServiceEntryRepo.approveAtomic).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
        'admin-1',
        null,
        0,
      );
      expect(result).toEqual(approved);
    });

    it('should forward the review comment to the atomic approval', async () => {
      const approved = {
        ...baseEntry,
        status: 'APPROVED' as const,
        reviewed_by: 'admin-1',
        review_comment: 'Verified at the shelter',
        points_awarded: true,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);
      mockServiceEntryRepo.approveAtomic.mockResolvedValue(approved);

      await service.approve(
        'se-1',
        'ch-1',
        'admin-1',
        'Verified at the shelter',
      );

      expect(mockServiceEntryRepo.approveAtomic).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
        'admin-1',
        'Verified at the shelter',
        1,
      );
    });

    it('should throw BadRequestException when entry is not PENDING', async () => {
      const approvedEntry = { ...baseEntry, status: 'APPROVED' as const };
      mockServiceEntryRepo.findById.mockResolvedValue(approvedEntry);

      await expect(
        service.approve('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.approve('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow('Only PENDING entries can be approved');
      expect(mockServiceEntryRepo.approveAtomic).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when points already awarded (data consistency)', async () => {
      const alreadyAwarded = {
        ...baseEntry,
        status: 'PENDING' as const,
        points_awarded: true,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(alreadyAwarded);

      await expect(
        service.approve('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.approve('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow('Points already awarded for this entry');
      expect(mockServiceEntryRepo.approveAtomic).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when a concurrent approval won the race (RPC no-op)', async () => {
      // Fast-path guards pass on a stale read, but the compare-and-set RPC
      // updates zero rows because another approval already flipped the entry —
      // the at-most-once guarantee. No notification is sent for the loser.
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);
      mockServiceEntryRepo.approveAtomic.mockResolvedValue(null);

      await expect(
        service.approve('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.approve('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow(
        'Service entry approval failed — entry is no longer eligible or points were already awarded',
      );
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('should propagate atomic-approval failures without notifying (transaction rolled back)', async () => {
      // The point award and status flip commit or roll back together inside the
      // RPC; if it errors, the service surfaces the failure rather than reporting
      // a partial success.
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);
      mockServiceEntryRepo.approveAtomic.mockRejectedValue(
        new Error('db transaction failed'),
      );

      await expect(
        service.approve('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow('db transaction failed');
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('should reject entry without creating point transaction', async () => {
      const rejected = {
        ...baseEntry,
        status: 'REJECTED' as const,
        reviewed_by: 'admin-1',
        review_comment: 'Insufficient proof',
      };
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);
      mockServiceEntryRepo.update.mockResolvedValue(rejected);

      const result = await service.reject(
        'se-1',
        'ch-1',
        'admin-1',
        'Insufficient proof',
      );

      expect(mockServiceEntryRepo.approveAtomic).not.toHaveBeenCalled();
      expect(mockServiceEntryRepo.update).toHaveBeenCalledWith('se-1', 'ch-1', {
        status: 'REJECTED',
        reviewed_by: 'admin-1',
        review_comment: 'Insufficient proof',
      });
      expect(result).toEqual(rejected);
    });

    it('should throw BadRequestException when entry is not PENDING', async () => {
      const rejectedEntry = { ...baseEntry, status: 'REJECTED' as const };
      mockServiceEntryRepo.findById.mockResolvedValue(rejectedEntry);

      await expect(
        service.reject('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.reject('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow('Only PENDING entries can be rejected');
    });
  });

  describe('delete', () => {
    it('should allow member to delete own PENDING entry', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);

      await service.delete('se-1', 'ch-1', 'user-1', false);

      expect(mockServiceEntryRepo.delete).toHaveBeenCalledWith('se-1', 'ch-1');
    });

    it('should allow admin to delete any PENDING entry', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);

      await service.delete('se-1', 'ch-1', 'admin-1', true);

      expect(mockServiceEntryRepo.delete).toHaveBeenCalledWith('se-1', 'ch-1');
    });

    it('should throw ForbiddenException when member tries to delete another user entry', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);

      await expect(
        service.delete('se-1', 'ch-1', 'other-user', false),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.delete('se-1', 'ch-1', 'other-user', false),
      ).rejects.toThrow('You can only delete your own service entries');
      expect(mockServiceEntryRepo.delete).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when entry is not PENDING', async () => {
      const approvedEntry = { ...baseEntry, status: 'APPROVED' as const };
      mockServiceEntryRepo.findById.mockResolvedValue(approvedEntry);

      await expect(
        service.delete('se-1', 'ch-1', 'user-1', false),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.delete('se-1', 'ch-1', 'user-1', false),
      ).rejects.toThrow('Only PENDING entries can be deleted');
      expect(mockServiceEntryRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('notifications', () => {
    it('should notify user when service hours are approved', async () => {
      const approved = {
        ...baseEntry,
        status: 'APPROVED' as const,
        reviewed_by: 'admin-1',
        points_awarded: true,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);
      mockServiceEntryRepo.approveAtomic.mockResolvedValue(approved);

      await service.approve('se-1', 'ch-1', 'admin-1', null);

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'Service Hours Approved',
          priority: 'NORMAL',
          category: 'service',
        }),
      );
    });

    it('should notify user when service hours are rejected', async () => {
      const rejected = {
        ...baseEntry,
        status: 'REJECTED' as const,
        reviewed_by: 'admin-1',
        review_comment: 'Insufficient proof',
      };
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);
      mockServiceEntryRepo.update.mockResolvedValue(rejected);

      await service.reject('se-1', 'ch-1', 'admin-1', 'Insufficient proof');

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'Service Hours Rejected',
          priority: 'NORMAL',
          category: 'service',
        }),
      );
    });
  });
});
