import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { PointsService } from './points.service';
import {
  POINT_TRANSACTION_REPOSITORY,
  IPointTransactionRepository,
} from '../../domain/repositories/point-transaction.repository.interface';
import {
  SEMESTER_ARCHIVE_REPOSITORY,
  ISemesterArchiveRepository,
} from '../../domain/repositories/semester-archive.repository.interface';
import type { PointTransaction } from '../../domain/entities/point-transaction.entity';
import { NotificationService } from './notification.service';

describe('PointsService', () => {
  let service: PointsService;
  let mockPointTxnRepo: jest.Mocked<IPointTransactionRepository>;
  let mockSemesterArchiveRepo: jest.Mocked<ISemesterArchiveRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;

  const txn1: PointTransaction = {
    id: 'pt-1',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    amount: 10,
    category: 'ATTENDANCE',
    description: 'Event check-in',
    metadata: {},
    created_at: '2026-02-26T18:00:00.000Z',
  };

  const txn2: PointTransaction = {
    id: 'pt-2',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    amount: 5,
    category: 'MANUAL',
    description: 'Bonus',
    metadata: { adjusted_by: 'admin-1' },
    created_at: '2026-02-26T19:00:00.000Z',
  };

  const txn3: PointTransaction = {
    id: 'pt-3',
    chapter_id: 'ch-1',
    user_id: 'user-2',
    amount: 20,
    category: 'ATTENDANCE',
    description: 'Event check-in',
    metadata: {},
    created_at: '2026-02-26T18:00:00.000Z',
  };

  beforeEach(async () => {
    mockPointTxnRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      findByChapter: jest.fn(),
      countRecentAdjustments: jest.fn().mockResolvedValue(0),
    };

    mockSemesterArchiveRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findLatestByChapter: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: POINT_TRANSACTION_REPOSITORY, useValue: mockPointTxnRepo },
        {
          provide: SEMESTER_ARCHIVE_REPOSITORY,
          useValue: mockSemesterArchiveRepo,
        },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get(PointsService);
  });

  describe('getUserSummary', () => {
    it('should return balance and transactions for user', async () => {
      mockPointTxnRepo.findByUser.mockResolvedValue([txn1, txn2]);

      const result = await service.getUserSummary('ch-1', 'user-1', 'all');

      expect(mockPointTxnRepo.findByUser).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(result.balance).toBe(15);
      expect(result.transactions).toHaveLength(2);
    });

    it('should return zero balance when no transactions', async () => {
      mockPointTxnRepo.findByUser.mockResolvedValue([]);

      const result = await service.getUserSummary('ch-1', 'user-1');

      expect(result.balance).toBe(0);
      expect(result.transactions).toEqual([]);
    });

    it('should filter by month window when provided', async () => {
      const recentTxn: PointTransaction = {
        ...txn1,
        created_at: new Date().toISOString(),
      };
      mockPointTxnRepo.findByUser.mockResolvedValue([txn1, recentTxn]);

      const result = await service.getUserSummary('ch-1', 'user-1', 'month');

      expect(mockPointTxnRepo.findByUser).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(result.transactions.length).toBeLessThanOrEqual(2);
      expect(result.balance).toBe(
        result.transactions.reduce((s, t) => s + t.amount, 0),
      );
    });
  });

  describe('getLeaderboard', () => {
    it('should return sorted leaderboard by total points', async () => {
      mockPointTxnRepo.findByChapter.mockResolvedValue([txn1, txn2, txn3]);

      const result = await service.getLeaderboard('ch-1', 'all');

      expect(mockPointTxnRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe('user-2');
      expect(result[0].total).toBe(20);
      expect(result[1].user_id).toBe('user-1');
      expect(result[1].total).toBe(15);
    });

    it('should return empty array when no transactions', async () => {
      mockPointTxnRepo.findByChapter.mockResolvedValue([]);

      const result = await service.getLeaderboard('ch-1');

      expect(result).toEqual([]);
    });
  });

  describe('adjustPoints', () => {
    it('should create transaction with adjusted_by and reason in metadata', async () => {
      const created: PointTransaction = {
        id: 'pt-new',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 50,
        category: 'MANUAL',
        description: 'Good work',
        metadata: {
          adjusted_by: 'admin-1',
          reason: 'Good work',
        },
        created_at: '2026-02-26T20:00:00.000Z',
      };
      mockPointTxnRepo.create.mockResolvedValue(created);

      const result = await service.adjustPoints({
        chapterId: 'ch-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: 50,
        category: 'MANUAL',
        reason: 'Good work',
      });

      expect(mockPointTxnRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 50,
        category: 'MANUAL',
        description: 'Good work',
        metadata: expect.objectContaining({
          adjusted_by: 'admin-1',
          reason: 'Good work',
        }),
      });
      expect(result).toEqual(created);
    });

    it('should throw BadRequestException when reason is empty', async () => {
      await expect(
        service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'user-2',
          adminUserId: 'admin-1',
          amount: 10,
          category: 'MANUAL',
          reason: '',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'user-2',
          adminUserId: 'admin-1',
          amount: 10,
          category: 'MANUAL',
          reason: '   ',
        }),
      ).rejects.toThrow('Reason is required for point adjustments');

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when admin adjusts own points', async () => {
      await expect(
        service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'admin-1',
          adminUserId: 'admin-1',
          amount: 10,
          category: 'MANUAL',
          reason: 'Self reward',
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'admin-1',
          adminUserId: 'admin-1',
          amount: 10,
          category: 'MANUAL',
          reason: 'Self reward',
        }),
      ).rejects.toThrow('Admins cannot adjust their own points');

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
    });

    it('should set flagged in metadata when amount >= 100', async () => {
      const created: PointTransaction = {
        id: 'pt-new',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 150,
        category: 'MANUAL',
        description: 'Large bonus',
        metadata: {
          adjusted_by: 'admin-1',
          reason: 'Large bonus',
          flagged: true,
        },
        created_at: '2026-02-26T20:00:00.000Z',
      };
      mockPointTxnRepo.create.mockResolvedValue(created);

      await service.adjustPoints({
        chapterId: 'ch-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: 150,
        category: 'MANUAL',
        reason: 'Large bonus',
      });

      expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ flagged: true }),
        }),
      );
    });

    it('should notify user when points are awarded', async () => {
      const created: PointTransaction = {
        id: 'pt-new',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 50,
        category: 'MANUAL',
        description: 'Good work',
        metadata: { adjusted_by: 'admin-1', reason: 'Good work' },
        created_at: '2026-02-26T20:00:00.000Z',
      };
      mockPointTxnRepo.create.mockResolvedValue(created);

      await service.adjustPoints({
        chapterId: 'ch-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: 50,
        category: 'MANUAL',
        reason: 'Good work',
      });

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'ch-1',
        expect.objectContaining({
          title: 'Points Awarded',
          priority: 'NORMAL',
          category: 'points',
        }),
      );
    });

    it('should notify user when points are deducted (fine)', async () => {
      const created: PointTransaction = {
        id: 'pt-new',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: -25,
        category: 'FINE',
        description: 'Late to meeting',
        metadata: { adjusted_by: 'admin-1', reason: 'Late to meeting' },
        created_at: '2026-02-26T20:00:00.000Z',
      };
      mockPointTxnRepo.create.mockResolvedValue(created);

      await service.adjustPoints({
        chapterId: 'ch-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: -25,
        category: 'FINE',
        reason: 'Late to meeting',
      });

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'ch-1',
        expect.objectContaining({
          title: 'Points Deducted',
          priority: 'NORMAL',
          category: 'points',
        }),
      );
    });

    it('should succeed when under rate limit', async () => {
      mockPointTxnRepo.countRecentAdjustments.mockResolvedValue(49);
      const created: PointTransaction = {
        id: 'pt-new',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 10,
        category: 'MANUAL',
        description: 'Bonus',
        metadata: { adjusted_by: 'admin-1', reason: 'Bonus' },
        created_at: '2026-02-26T20:00:00.000Z',
      };
      mockPointTxnRepo.create.mockResolvedValue(created);

      const result = await service.adjustPoints({
        chapterId: 'ch-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: 10,
        category: 'MANUAL',
        reason: 'Bonus',
      });

      expect(result).toEqual(created);
      expect(mockPointTxnRepo.countRecentAdjustments).toHaveBeenCalledWith(
        'admin-1',
        'ch-1',
        expect.any(Date),
      );
    });

    it('should return 429 when rate limit is reached', async () => {
      mockPointTxnRepo.countRecentAdjustments.mockResolvedValue(50);

      await expect(
        service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'user-2',
          adminUserId: 'admin-1',
          amount: 10,
          category: 'MANUAL',
          reason: 'Bonus',
        }),
      ).rejects.toThrow(HttpException);

      await expect(
        service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'user-2',
          adminUserId: 'admin-1',
          amount: 10,
          category: 'MANUAL',
          reason: 'Bonus',
        }),
      ).rejects.toMatchObject({
        status: 429,
        message: 'Rate limit exceeded: maximum 50 point adjustments per hour',
      });

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('semester-aware leaderboard', () => {
    it('should use semester archive dates when available', async () => {
      const archiveStart = '2026-01-15T00:00:00.000Z';
      const archiveEnd = '2026-06-15T00:00:00.000Z';
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue({
        id: 'sa-1',
        chapter_id: 'ch-1',
        label: 'Spring 2026',
        start_date: archiveStart,
        end_date: archiveEnd,
        created_at: '2026-01-15T00:00:00.000Z',
      });

      const inRange: PointTransaction = {
        ...txn1,
        created_at: '2026-02-01T00:00:00.000Z',
      };
      const outOfRange: PointTransaction = {
        ...txn3,
        created_at: '2025-12-01T00:00:00.000Z',
      };
      mockPointTxnRepo.findByChapter.mockResolvedValue([inRange, outOfRange]);

      const result = await service.getLeaderboard('ch-1', 'semester');

      expect(mockSemesterArchiveRepo.findLatestByChapter).toHaveBeenCalledWith(
        'ch-1',
      );
      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe('user-1');
      expect(result[0].total).toBe(10);
    });

    it('should fall back to all-time when no archive exists', async () => {
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue(null);
      mockPointTxnRepo.findByChapter.mockResolvedValue([txn1, txn2, txn3]);

      const result = await service.getLeaderboard('ch-1', 'semester');

      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe('user-2');
      expect(result[0].total).toBe(20);
    });
  });
});
