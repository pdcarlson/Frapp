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
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import { NotificationService } from './notification.service';
import {
  ChapterWorkflowsService,
  WORKFLOW_HOURS_RECEIPT,
} from './chapter-workflows.service';
import { ChapterServiceConfigService } from './chapter-service-config.service';

describe('ServiceEntryService', () => {
  let service: ServiceEntryService;
  let mockServiceEntryRepo: jest.Mocked<IServiceEntryRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockChapterWorkflows: jest.Mocked<
    Pick<ChapterWorkflowsService, 'getWorkflow'>
  >;
  let mockChapterServiceConfig: jest.Mocked<
    Pick<ChapterServiceConfigService, 'getMinutesPerPoint'>
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
      findByChapterFiltered: jest.fn(),
      leaderboard: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      approveAtomic: jest.fn(),
      delete: jest.fn(),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn().mockResolvedValue('https://signed-upload'),
      getSignedDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://signed-download'),
      uploadFile: jest.fn().mockResolvedValue(undefined),
      downloadFile: jest.fn().mockResolvedValue(null),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      deleteFiles: jest.fn().mockResolvedValue(undefined),
      listFiles: jest.fn().mockResolvedValue([]),
      listObjects: jest.fn().mockResolvedValue([]),
      listFolders: jest.fn().mockResolvedValue([]),
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

    // Default: the pre-existing hardcoded rate, so every approval case that
    // predates configurable rates keeps asserting the same point math.
    mockChapterServiceConfig = {
      getMinutesPerPoint: jest.fn().mockResolvedValue(60),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceEntryService,
        { provide: SERVICE_ENTRY_REPOSITORY, useValue: mockServiceEntryRepo },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: ChapterWorkflowsService, useValue: mockChapterWorkflows },
        {
          provide: ChapterServiceConfigService,
          useValue: mockChapterServiceConfig,
        },
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

    it('should create entry with a valid uploaded proof_path', async () => {
      const proofPath = 'chapters/ch-1/service/proof-1/proof.pdf';
      const withProof = { ...baseEntry, proof_path: proofPath };
      mockServiceEntryRepo.create.mockResolvedValue(withProof);
      mockStorageProvider.listFiles.mockResolvedValue([proofPath]);

      await service.create({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        date: '2026-02-26',
        duration_minutes: 30,
        description: 'Volunteer work',
        proof_path: proofPath,
      });

      expect(mockStorageProvider.listFiles).toHaveBeenCalledWith(
        'service',
        'chapters/ch-1/service/proof-1',
      );
      expect(mockServiceEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ proof_path: proofPath }),
      );
    });

    it('should not touch storage when no proof_path is provided', async () => {
      mockServiceEntryRepo.create.mockResolvedValue(baseEntry);

      await service.create({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        date: '2026-02-26',
        duration_minutes: 60,
        description: 'Community cleanup',
      });

      expect(mockStorageProvider.listFiles).not.toHaveBeenCalled();
    });

    it('should reject a proof_path outside the chapter service-proof prefix', async () => {
      for (const proofPath of [
        'chapters/ch-2/service/proof-1/proof.pdf',
        'chapters/ch-1/documents/doc-1/proof.pdf',
        'https://example.com/proof.pdf',
        'service/proof.pdf',
      ]) {
        await expect(
          service.create({
            chapter_id: 'ch-1',
            user_id: 'user-1',
            date: '2026-02-26',
            duration_minutes: 60,
            description: 'Test',
            proof_path: proofPath,
          }),
        ).rejects.toThrow(
          'proof_path must be a storage path within the chapter service-proof folder',
        );
      }
      expect(mockServiceEntryRepo.create).not.toHaveBeenCalled();
      expect(mockStorageProvider.listFiles).not.toHaveBeenCalled();
    });

    it('should reject a proof_path that traverses out of the prefix', async () => {
      for (const proofPath of [
        'chapters/ch-1/service/../../ch-2/service/proof-1/proof.pdf',
        'chapters/ch-1/service/./proof.pdf',
        'chapters/ch-1/service//proof.pdf',
        'chapters/ch-1/service/',
      ]) {
        await expect(
          service.create({
            chapter_id: 'ch-1',
            user_id: 'user-1',
            date: '2026-02-26',
            duration_minutes: 60,
            description: 'Test',
            proof_path: proofPath,
          }),
        ).rejects.toThrow(BadRequestException);
      }
      expect(mockServiceEntryRepo.create).not.toHaveBeenCalled();
      expect(mockStorageProvider.listFiles).not.toHaveBeenCalled();
    });

    it('should reject a proof_path whose object was never uploaded', async () => {
      mockStorageProvider.listFiles.mockResolvedValue([]);

      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          date: '2026-02-26',
          duration_minutes: 60,
          description: 'Test',
          proof_path: 'chapters/ch-1/service/proof-1/proof.pdf',
        }),
      ).rejects.toThrow('proof_path does not reference an uploaded proof file');
      expect(mockServiceEntryRepo.create).not.toHaveBeenCalled();
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
      mockStorageProvider.listFiles.mockResolvedValue([
        'chapters/ch-1/service/se-1/proof.pdf',
      ]);

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

    it('should store trimmed proof', async () => {
      mockServiceEntryRepo.create.mockResolvedValue(baseEntry);
      mockStorageProvider.listFiles.mockResolvedValue([
        'chapters/ch-1/service/se-1/proof.pdf',
      ]);

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

    it('should normalize whitespace-only proof to null when the workflow is disabled', async () => {
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
        proof_path: '   ',
      });

      expect(mockServiceEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ proof_path: null }),
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

  describe('requestProofUploadUrl', () => {
    it('should return a signed URL under the chapter service-proof prefix', async () => {
      const result = await service.requestProofUploadUrl({
        chapterId: 'ch-1',
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      });

      expect(result.signedUrl).toBe('https://signed-upload');
      expect(result.storagePath).toMatch(
        /^chapters\/ch-1\/service\/[0-9a-f-]{36}\/receipt\.pdf$/,
      );
      expect(result.storagePath).toContain(result.proofId);
      expect(mockStorageProvider.getSignedUploadUrl).toHaveBeenCalledWith(
        'service',
        result.storagePath,
        'application/pdf',
      );
    });

    it('should strip directory components from the filename', async () => {
      const result = await service.requestProofUploadUrl({
        chapterId: 'ch-1',
        filename: '../../etc/passwd.png',
        contentType: 'image/png',
      });

      expect(result.storagePath).toMatch(
        /^chapters\/ch-1\/service\/[0-9a-f-]{36}\/passwd\.png$/,
      );
    });

    it('should squash storage-unsafe filename characters to underscores', async () => {
      const result = await service.requestProofUploadUrl({
        chapterId: 'ch-1',
        filename: 'café cleanup #2.jpg',
        contentType: 'image/jpeg',
      });

      expect(result.storagePath).toMatch(
        /^chapters\/ch-1\/service\/[0-9a-f-]{36}\/caf__cleanup__2\.jpg$/,
      );
    });

    it('should mint a lowercase chapter prefix for a non-canonical chapterId', async () => {
      const result = await service.requestProofUploadUrl({
        chapterId: 'CH-1',
        filename: 'proof.pdf',
        contentType: 'application/pdf',
      });

      expect(result.storagePath).toMatch(/^chapters\/ch-1\/service\//);
    });

    it('should reject a disallowed file extension', async () => {
      await expect(
        service.requestProofUploadUrl({
          chapterId: 'ch-1',
          filename: 'malware.exe',
          contentType: 'application/pdf',
        }),
      ).rejects.toThrow('File extension is not allowed');
      expect(mockStorageProvider.getSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('should reject a disallowed content type', async () => {
      await expect(
        service.requestProofUploadUrl({
          chapterId: 'ch-1',
          filename: 'proof.pdf',
          contentType: 'application/zip',
        }),
      ).rejects.toThrow('Content type "application/zip" is not allowed');
      expect(mockStorageProvider.getSignedUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('getProofDownloadUrl', () => {
    const proofEntry: ServiceEntry = {
      ...baseEntry,
      proof_path: 'chapters/ch-1/service/proof-1/proof.pdf',
    };

    it('should return a signed download URL for the entry owner', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(proofEntry);

      const result = await service.getProofDownloadUrl(
        'se-1',
        'ch-1',
        'user-1',
        false,
      );

      expect(result).toEqual({ url: 'https://signed-download' });
      expect(mockStorageProvider.getSignedDownloadUrl).toHaveBeenCalledWith(
        'service',
        'chapters/ch-1/service/proof-1/proof.pdf',
      );
    });

    it('should return a signed download URL for an admin reviewer', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(proofEntry);

      const result = await service.getProofDownloadUrl(
        'se-1',
        'ch-1',
        'admin-1',
        true,
      );

      expect(result).toEqual({ url: 'https://signed-download' });
    });

    it('should throw ForbiddenException for another member', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(proofEntry);

      await expect(
        service.getProofDownloadUrl('se-1', 'ch-1', 'user-2', false),
      ).rejects.toThrow(ForbiddenException);
      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the entry has no proof', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);

      await expect(
        service.getProofDownloadUrl('se-1', 'ch-1', 'user-1', false),
      ).rejects.toThrow('Service entry has no proof file');
    });

    it('should never sign a legacy proof_path outside the chapter prefix', async () => {
      for (const proofPath of [
        'https://example.com/proof.pdf',
        'chapters/ch-2/service/proof-1/proof.pdf',
      ]) {
        mockServiceEntryRepo.findById.mockResolvedValue({
          ...baseEntry,
          proof_path: proofPath,
        });

        await expect(
          service.getProofDownloadUrl('se-1', 'ch-1', 'user-1', false),
        ).rejects.toThrow('Proof file is not available for download');
      }
      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('should return 404 when the proof object no longer exists in storage', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(proofEntry);
      mockStorageProvider.getSignedDownloadUrl.mockRejectedValue(
        new Error('Object not found'),
      );

      await expect(
        service.getProofDownloadUrl('se-1', 'ch-1', 'user-1', false),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getProofDownloadUrl('se-1', 'ch-1', 'user-1', false),
      ).rejects.toThrow('Proof file is not available for download');
    });

    it('should propagate non-missing-object storage failures unchanged', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue(proofEntry);
      mockStorageProvider.getSignedDownloadUrl.mockRejectedValue(
        new Error('Service unavailable'),
      );

      await expect(
        service.getProofDownloadUrl('se-1', 'ch-1', 'user-1', false),
      ).rejects.toThrow('Service unavailable');
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

  describe('approve — chapter-configurable rate', () => {
    const approvedFor = (entry: ServiceEntry) => ({
      ...entry,
      status: 'APPROVED' as const,
      reviewed_by: 'admin-1',
      review_comment: null,
      points_awarded: true,
    });

    it('awards on the chapter rate, not the 60-minute default', async () => {
      // 90 minutes at 30 min/point = 3 points; the old hardcoded rate would
      // have awarded 1.
      const entry = { ...baseEntry, duration_minutes: 90 };
      mockChapterServiceConfig.getMinutesPerPoint.mockResolvedValue(30);
      mockServiceEntryRepo.findById.mockResolvedValue(entry);
      mockServiceEntryRepo.approveAtomic.mockResolvedValue(approvedFor(entry));

      await service.approve('se-1', 'ch-1', 'admin-1', null);

      expect(mockChapterServiceConfig.getMinutesPerPoint).toHaveBeenCalledWith(
        'ch-1',
      );
      expect(mockServiceEntryRepo.approveAtomic).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
        'admin-1',
        null,
        3,
      );
    });

    it('floors sub-rate durations to zero points and still approves', async () => {
      // 45 minutes at 60 min/point rounds down to no ledger row, per the spec's
      // "Sub-rate durations approve with no ledger row".
      const entry = { ...baseEntry, duration_minutes: 45 };
      mockChapterServiceConfig.getMinutesPerPoint.mockResolvedValue(60);
      mockServiceEntryRepo.findById.mockResolvedValue(entry);
      mockServiceEntryRepo.approveAtomic.mockResolvedValue({
        ...approvedFor(entry),
        points_awarded: false,
      });

      const result = await service.approve('se-1', 'ch-1', 'admin-1', null);

      expect(mockServiceEntryRepo.approveAtomic).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
        'admin-1',
        null,
        0,
      );
      expect(result.status).toBe('APPROVED');
    });

    it('keeps the award idempotent — an already-awarded entry never reaches the RPC', async () => {
      // The rate lookup must not weaken the existing guard: a second approval
      // is rejected before any points are recomputed.
      mockChapterServiceConfig.getMinutesPerPoint.mockResolvedValue(15);
      mockServiceEntryRepo.findById.mockResolvedValue({
        ...baseEntry,
        points_awarded: true,
      });

      await expect(
        service.approve('se-1', 'ch-1', 'admin-1', null),
      ).rejects.toThrow('Points already awarded for this entry');
      expect(mockServiceEntryRepo.approveAtomic).not.toHaveBeenCalled();
    });
  });

  describe('findByChapterFiltered', () => {
    it('passes status, date range, and member through to the repository', async () => {
      mockServiceEntryRepo.findByChapterFiltered.mockResolvedValue([baseEntry]);

      const result = await service.findByChapterFiltered('ch-1', {
        status: 'PENDING',
        startDate: '2026-01-01',
        endDate: '2026-05-31',
        userId: 'user-1',
      });

      expect(mockServiceEntryRepo.findByChapterFiltered).toHaveBeenCalledWith(
        'ch-1',
        {
          status: 'PENDING',
          startDate: '2026-01-01',
          endDate: '2026-05-31',
          userId: 'user-1',
        },
      );
      expect(result).toEqual([baseEntry]);
    });

    it('rejects an inverted date range instead of silently returning nothing', async () => {
      await expect(
        service.findByChapterFiltered('ch-1', {
          startDate: '2026-05-31',
          endDate: '2026-01-01',
        }),
      ).rejects.toThrow('start_date must not be after end_date');
      expect(mockServiceEntryRepo.findByChapterFiltered).not.toHaveBeenCalled();
    });

    it.each([
      ['unparseable text', 'not-a-date'],
      // `new Date('2026-02-30')` silently rolls to March 2, but the `date`
      // column rejects it — without the round-trip check this reached
      // PostgREST and came back a 500.
      ['a nonexistent calendar day', '2026-02-30'],
      ['an unpadded legacy spelling', '2026-3-1'],
      ['a full timestamp', '2026-03-01T00:00:00Z'],
    ])('rejects %s', async (_label, startDate) => {
      await expect(
        service.findByChapterFiltered('ch-1', { startDate }),
      ).rejects.toThrow('start_date must be a valid YYYY-MM-DD date');
      expect(mockServiceEntryRepo.findByChapterFiltered).not.toHaveBeenCalled();
    });

    it('accepts a same-day range (both bounds inclusive)', async () => {
      mockServiceEntryRepo.findByChapterFiltered.mockResolvedValue([]);

      await service.findByChapterFiltered('ch-1', {
        startDate: '2026-03-01',
        endDate: '2026-03-01',
      });

      expect(mockServiceEntryRepo.findByChapterFiltered).toHaveBeenCalled();
    });
  });

  describe('leaderboard', () => {
    const row = {
      user_id: 'user-1',
      member_name: 'Alex Rivera',
      total_minutes: 240,
      entry_count: 3,
    };

    it('returns the aggregated ranking for an all-time window', async () => {
      mockServiceEntryRepo.leaderboard.mockResolvedValue([row]);

      const result = await service.leaderboard('ch-1');

      expect(mockServiceEntryRepo.leaderboard).toHaveBeenCalledWith('ch-1', {});
      expect(result).toEqual([row]);
    });

    it('forwards an explicit date window', async () => {
      mockServiceEntryRepo.leaderboard.mockResolvedValue([]);

      await service.leaderboard('ch-1', {
        startDate: '2026-01-01',
        endDate: '2026-05-31',
      });

      expect(mockServiceEntryRepo.leaderboard).toHaveBeenCalledWith('ch-1', {
        startDate: '2026-01-01',
        endDate: '2026-05-31',
      });
    });

    it('rejects an inverted date range', async () => {
      await expect(
        service.leaderboard('ch-1', {
          startDate: '2026-06-01',
          endDate: '2026-01-01',
        }),
      ).rejects.toThrow('start_date must not be after end_date');
      expect(mockServiceEntryRepo.leaderboard).not.toHaveBeenCalled();
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
      expect(mockStorageProvider.deleteFile).not.toHaveBeenCalled();
    });

    it('should purge the proof object when deleting an entry with proof', async () => {
      const proofPath = 'chapters/ch-1/service/proof-1/proof.pdf';
      mockServiceEntryRepo.findById.mockResolvedValue({
        ...baseEntry,
        proof_path: proofPath,
      });

      await service.delete('se-1', 'ch-1', 'user-1', false);

      expect(mockStorageProvider.deleteFile).toHaveBeenCalledWith(
        'service',
        proofPath,
      );
      expect(mockServiceEntryRepo.delete).toHaveBeenCalledWith('se-1', 'ch-1');
    });

    it('should not touch storage when deleting an entry with a legacy proof path', async () => {
      mockServiceEntryRepo.findById.mockResolvedValue({
        ...baseEntry,
        proof_path: 'https://example.com/proof.pdf',
      });

      await service.delete('se-1', 'ch-1', 'user-1', false);

      expect(mockStorageProvider.deleteFile).not.toHaveBeenCalled();
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
