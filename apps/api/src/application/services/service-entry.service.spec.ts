import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ServiceEntryService } from './service-entry.service';
import { SERVICE_ENTRY_REPOSITORY } from '../../domain/repositories/service-entry.repository.interface';
import type { IServiceEntryRepository } from '../../domain/repositories/service-entry.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import type { ServiceEntry } from '../../domain/entities/service-entry.entity';
import type { PointTransaction } from '../../domain/entities/point-transaction.entity';
import { NotificationService } from './notification.service';

describe('ServiceEntryService', () => {
  let service: ServiceEntryService;
  let mockServiceEntryRepo: jest.Mocked<IServiceEntryRepository>;
  let mockPointTxnRepo: jest.Mocked<IPointTransactionRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;

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

  const basePointTxn: PointTransaction = {
    id: 'pt-1',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    amount: 1,
    category: 'SERVICE',
    description: 'Service hours approved: Community cleanup',
    metadata: { service_entry_id: 'se-1' },
    created_at: '2026-02-26T10:00:00.000Z',
  };

  beforeEach(async () => {
    mockServiceEntryRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByUser: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockPointTxnRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      findByChapter: jest.fn(),
      findByChapterFiltered: jest.fn(),
      countRecentAdjustments: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceEntryService,
        { provide: SERVICE_ENTRY_REPOSITORY, useValue: mockServiceEntryRepo },
        {
          provide: POINT_TRANSACTION_REPOSITORY,
          useValue: mockPointTxnRepo,
        },
        { provide: NotificationService, useValue: mockNotificationService },
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
    it('should approve entry and create point transaction', async () => {
      const approved = {
        ...baseEntry,
        status: 'APPROVED' as const,
        reviewed_by: 'admin-1',
        review_comment: null,
        points_awarded: true,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(baseEntry);
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);
      mockServiceEntryRepo.update.mockResolvedValue(approved);

      const result = await service.approve('se-1', 'ch-1', 'admin-1', null);

      expect(mockPointTxnRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        amount: 1,
        category: 'SERVICE',
        description: 'Service hours approved: Community cleanup',
        metadata: { service_entry_id: 'se-1' },
      });
      expect(mockServiceEntryRepo.update).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
        expect.objectContaining({
          status: 'APPROVED',
          reviewed_by: 'admin-1',
          points_awarded: true,
        }),
      );
      expect(result).toEqual(approved);
    });

    it('should award multiple points for longer duration', async () => {
      const longEntry = { ...baseEntry, duration_minutes: 120 };
      const approved = {
        ...longEntry,
        status: 'APPROVED' as const,
        reviewed_by: 'admin-1',
        points_awarded: true,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(longEntry);
      mockPointTxnRepo.create.mockResolvedValue({
        ...basePointTxn,
        amount: 2,
      });
      mockServiceEntryRepo.update.mockResolvedValue(approved);

      await service.approve('se-1', 'ch-1', 'admin-1', null);

      expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2 }),
      );
    });

    it('should not create point transaction when duration yields zero points', async () => {
      const shortEntry = { ...baseEntry, duration_minutes: 30 };
      const approved = {
        ...shortEntry,
        status: 'APPROVED' as const,
        reviewed_by: 'admin-1',
        points_awarded: false,
      };
      mockServiceEntryRepo.findById.mockResolvedValue(shortEntry);
      mockServiceEntryRepo.update.mockResolvedValue(approved);

      await service.approve('se-1', 'ch-1', 'admin-1', null);

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      expect(mockServiceEntryRepo.update).toHaveBeenCalledWith(
        'se-1',
        'ch-1',
        expect.objectContaining({ points_awarded: false }),
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
      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
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
      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
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

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
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
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);
      mockServiceEntryRepo.update.mockResolvedValue(approved);

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
