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
import {
  USER_REPOSITORY,
  IUserRepository,
} from '../../domain/repositories/user.repository.interface';
import type { PointTransaction } from '../../domain/entities/point-transaction.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';

describe('PointsService', () => {
  let service: PointsService;
  let mockPointTxnRepo: jest.Mocked<IPointTransactionRepository>;
  let mockSemesterArchiveRepo: jest.Mocked<ISemesterArchiveRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockChatService: jest.Mocked<Pick<ChatService, 'sendMessage'>>;

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
    user_id: 'user-2',
    amount: 5,
    category: 'MANUAL',
    description: 'Bonus',
    metadata: { adjusted_by: 'admin-1' },
    created_at: '2026-02-26T19:00:00.000Z',
  };

  /** Second transaction for `user-1` (same shape as the old `txn2` when it was mislabeled user-1). */
  const txn1b: PointTransaction = {
    ...txn2,
    id: 'pt-1b',
    user_id: 'user-1',
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
      findByChapterFiltered: jest.fn(),
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

    mockUserRepo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([
        { id: 'admin-1', display_name: 'Alex Admin' },
        { id: 'user-2', display_name: 'Bobby Member' },
      ]),
      findDisplayIdentitiesByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
    };

    mockChatService = {
      sendMessage: jest
        .fn()
        .mockResolvedValue({ message: {}, deduplicated: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: POINT_TRANSACTION_REPOSITORY, useValue: mockPointTxnRepo },
        {
          provide: SEMESTER_ARCHIVE_REPOSITORY,
          useValue: mockSemesterArchiveRepo,
        },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: ChatService, useValue: mockChatService },
      ],
    }).compile();

    service = module.get(PointsService);
  });

  describe('getUserSummary', () => {
    it('should return balance and transactions for user', async () => {
      mockPointTxnRepo.findByUser.mockResolvedValue([txn1, txn1b]);

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

    describe('active semester window', () => {
      beforeEach(() => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2027-01-10T00:00:00.000Z'));
      });
      afterEach(() => {
        jest.useRealTimers();
      });

      it('filters to transactions after the latest archive end_date day', async () => {
        mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue({
          id: 'sa-1',
          chapter_id: 'ch-1',
          label: 'Spring 2026',
          start_date: '2026-01-15',
          end_date: '2026-06-15',
          created_at: '2026-06-15T12:00:00.000Z',
        });

        const active: PointTransaction = {
          ...txn1, // amount 10 — day after end_date → active
          created_at: '2026-06-16T00:00:00.000Z',
        };
        const onEndDateDay: PointTransaction = {
          ...txn1b, // amount 5 — later on end_date day → archived, excluded
          created_at: '2026-06-15T18:00:00.000Z',
        };
        mockPointTxnRepo.findByUser.mockResolvedValue([active, onEndDateDay]);

        const result = await service.getUserSummary(
          'ch-1',
          'user-1',
          'semester',
        );

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].id).toBe('pt-1');
        expect(result.balance).toBe(10);
      });
    });
  });

  describe('getLeaderboard', () => {
    it('should return sorted leaderboard by total points', async () => {
      mockPointTxnRepo.findByChapter.mockResolvedValue([txn1, txn2, txn3]);

      const result = await service.getLeaderboard('ch-1', 'all');

      expect(mockPointTxnRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe('user-2');
      expect(result[0].total).toBe(25);
      expect(result[1].user_id).toBe('user-1');
      expect(result[1].total).toBe(10);
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

    it('posts a server-originated points card when a channel + client id are given', async () => {
      const created: PointTransaction = {
        id: 'pt-card',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 5,
        category: 'MANUAL',
        description: 'great work',
        metadata: { adjusted_by: 'admin-1', reason: 'great work' },
        created_at: '2026-02-26T20:00:00.000Z',
      };
      mockPointTxnRepo.create.mockResolvedValue(created);

      await service.adjustPoints({
        chapterId: 'ch-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: 5,
        category: 'MANUAL',
        reason: 'great work',
        channelId: 'chan-1',
        clientMessageId: 'cmid-1',
      });

      expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockChatService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          channel_id: 'chan-1',
          sender_id: 'admin-1',
          kind: 'points',
          client_message_id: 'cmid-1',
          system_originated: true,
          payload: expect.objectContaining({
            actor_name: 'Alex Admin',
            recipient_user_id: 'user-2',
            recipient_name: 'Bobby Member',
            amount: 5,
            category: 'MANUAL',
            reason: 'great work',
            transaction_id: 'pt-card',
          }),
        }),
      );
    });

    it('does not post a card for a dashboard adjustment (no channel id)', async () => {
      const created: PointTransaction = {
        id: 'pt-nocard',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 5,
        category: 'MANUAL',
        description: 'dashboard reward',
        metadata: { adjusted_by: 'admin-1', reason: 'dashboard reward' },
        created_at: '2026-02-26T20:00:00.000Z',
      };
      mockPointTxnRepo.create.mockResolvedValue(created);

      await service.adjustPoints({
        chapterId: 'ch-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: 5,
        category: 'MANUAL',
        reason: 'dashboard reward',
      });

      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it('still commits the ledger when the chat post fails (append-only, best-effort)', async () => {
      const created: PointTransaction = {
        id: 'pt-besteffort',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 5,
        category: 'MANUAL',
        description: 'great work',
        metadata: { adjusted_by: 'admin-1', reason: 'great work' },
        created_at: '2026-02-26T20:00:00.000Z',
      };
      mockPointTxnRepo.create.mockResolvedValue(created);
      mockChatService.sendMessage.mockRejectedValue(new Error('channel gone'));

      const result = await service.adjustPoints({
        chapterId: 'ch-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: 5,
        category: 'MANUAL',
        reason: 'great work',
        channelId: 'chan-1',
        clientMessageId: 'cmid-1',
      });

      expect(result).toEqual(created);
      expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('semester-aware leaderboard (active period)', () => {
    // The active "this semester" window is everything created after the END of
    // the latest archive's end_date calendar day, through now. Pin "now" so the
    // upper bound (<= now) is deterministic regardless of when the suite runs.
    const NOW = new Date('2027-01-10T00:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW);
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('counts only transactions after the end_date day, through now', async () => {
      // end_date is a SQL `date` (bare 'YYYY-MM-DD'); the archived period covers
      // the whole of 2026-06-15.
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue({
        id: 'sa-1',
        chapter_id: 'ch-1',
        label: 'Spring 2026',
        start_date: '2026-01-15',
        end_date: '2026-06-15',
        created_at: '2026-06-15T12:00:00.000Z',
      });

      const active: PointTransaction = {
        ...txn1, // user-1, amount 10 — day after end_date → active
        created_at: '2026-06-16T09:00:00.000Z',
      };
      const onEndDateDay: PointTransaction = {
        ...txn3, // user-2, amount 20 — later on end_date day → archived, excluded
        created_at: '2026-06-15T23:00:00.000Z',
      };
      const beforeEnd: PointTransaction = {
        ...txn2, // user-2, amount 5 — inside archived range, excluded
        created_at: '2026-02-01T00:00:00.000Z',
      };
      const future: PointTransaction = {
        ...txn1b, // user-1, amount 5 — after `now`, excluded by the upper bound
        created_at: '2027-06-01T00:00:00.000Z',
      };
      mockPointTxnRepo.findByChapter.mockResolvedValue([
        active,
        onEndDateDay,
        beforeEnd,
        future,
      ]);

      const result = await service.getLeaderboard('ch-1', 'semester');

      expect(mockSemesterArchiveRepo.findLatestByChapter).toHaveBeenCalledWith(
        'ch-1',
      );
      // Only `active` qualifies: onEndDateDay and beforeEnd are archived, and
      // `future` is beyond `now`.
      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe('user-1');
      expect(result[0].total).toBe(10);
    });

    it('treats the entire end_date day as archived (day boundary)', async () => {
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue({
        id: 'sa-2',
        chapter_id: 'ch-1',
        label: 'Fall 2026',
        start_date: '2026-08-01',
        end_date: '2026-12-31',
        created_at: '2026-12-31T12:00:00.000Z',
      });

      const lastInstantOfEndDay: PointTransaction = {
        ...txn3, // user-2 — 23:59:59.999 on end_date → archived, excluded
        created_at: '2026-12-31T23:59:59.999Z',
      };
      const firstInstantOfNextDay: PointTransaction = {
        ...txn1, // user-1 — 00:00 next day → active, included
        created_at: '2027-01-01T00:00:00.000Z',
      };
      mockPointTxnRepo.findByChapter.mockResolvedValue([
        lastInstantOfEndDay,
        firstInstantOfNextDay,
      ]);

      const result = await service.getLeaderboard('ch-1', 'semester');

      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe('user-1');
    });

    it('should fall back to all-time when no archive exists', async () => {
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue(null);
      mockPointTxnRepo.findByChapter.mockResolvedValue([txn1, txn2, txn3]);

      const result = await service.getLeaderboard('ch-1', 'semester');

      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe('user-2');
      expect(result[0].total).toBe(25);
    });

    it('falls back to all-time when the archive end_date is unparseable', async () => {
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue({
        id: 'sa-bad',
        chapter_id: 'ch-1',
        label: 'Bad',
        start_date: '2026-01-01',
        end_date: 'not-a-date',
        created_at: '2026-01-01T00:00:00.000Z',
      });
      mockPointTxnRepo.findByChapter.mockResolvedValue([txn1, txn2, txn3]);

      const result = await service.getLeaderboard('ch-1', 'semester');

      // Unparseable end_date → getSemesterRange returns undefined → all-time.
      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe('user-2');
      expect(result[0].total).toBe(25);
    });
  });

  describe('listTransactions', () => {
    const flagged: PointTransaction = {
      id: 'pt-flagged',
      chapter_id: 'ch-1',
      user_id: 'user-2',
      amount: -200,
      category: 'FINE',
      description: 'Anomaly check',
      metadata: { flagged: true, adjusted_by: 'admin-1' },
      created_at: '2026-02-27T10:00:00.000Z',
    };

    it('returns newest-first, capped at the requested limit', async () => {
      mockPointTxnRepo.findByChapterFiltered.mockResolvedValue([
        flagged,
        txn2,
        txn1,
      ]);

      const result = await service.listTransactions('ch-1', { limit: 3 });

      expect(mockPointTxnRepo.findByChapterFiltered).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ limit: 3 }),
      );
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('pt-flagged');
      expect(result[1].id).toBe('pt-2');
      expect(result[2].id).toBe('pt-1');
    });

    it('filters to a single user', async () => {
      // Repo applies `userId` in SQL; the service returns rows as-is (no re-filter).
      mockPointTxnRepo.findByChapterFiltered.mockResolvedValue([txn1, txn1b]);

      const result = await service.listTransactions('ch-1', {
        userId: 'user-1',
      });

      expect(mockPointTxnRepo.findByChapterFiltered).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(result.every((txn) => txn.user_id === 'user-1')).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('filters to a category', async () => {
      mockPointTxnRepo.findByChapterFiltered.mockResolvedValue([flagged]);

      const result = await service.listTransactions('ch-1', {
        category: 'FINE',
      });

      expect(mockPointTxnRepo.findByChapterFiltered).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ category: 'FINE' }),
      );
      expect(result).toEqual([flagged]);
    });

    it('filters to flagged transactions when flagged=true', async () => {
      mockPointTxnRepo.findByChapterFiltered.mockResolvedValue([flagged]);

      const result = await service.listTransactions('ch-1', { flagged: true });

      expect(mockPointTxnRepo.findByChapterFiltered).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ flagged: true }),
      );
      expect(result).toEqual([flagged]);
    });

    it('excludes flagged transactions when flagged=false', async () => {
      mockPointTxnRepo.findByChapterFiltered.mockResolvedValue([
        txn1,
        txn2,
        txn3,
      ]);

      const result = await service.listTransactions('ch-1', {
        flagged: false,
      });

      expect(mockPointTxnRepo.findByChapterFiltered).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ flagged: false }),
      );
      expect(result.map((txn) => txn.id)).not.toContain('pt-flagged');
      expect(result).toHaveLength(3);
    });

    it('applies a `before` cursor strictly', async () => {
      mockPointTxnRepo.findByChapterFiltered.mockResolvedValue([
        txn2,
        txn1,
        txn3,
      ]);

      const before = '2026-02-27T10:00:00.000Z';
      const result = await service.listTransactions('ch-1', {
        before,
      });

      expect(mockPointTxnRepo.findByChapterFiltered).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          before: new Date(before).toISOString(),
        }),
      );
      expect(result.map((txn) => txn.id)).not.toContain('pt-flagged');
    });

    it('clamps limit to the 1-200 range', async () => {
      const many = Array.from({ length: 5 }, (_, idx) => ({
        ...txn1,
        id: `pt-many-${idx}`,
        created_at: new Date(2026, 0, idx + 1).toISOString(),
      }));
      mockPointTxnRepo.findByChapterFiltered.mockImplementation(
        async (_chapterId, opts) => many.slice(0, opts.limit),
      );

      const tooLow = await service.listTransactions('ch-1', { limit: 0 });
      expect(mockPointTxnRepo.findByChapterFiltered).toHaveBeenLastCalledWith(
        'ch-1',
        expect.objectContaining({ limit: 1 }),
      );
      expect(tooLow).toHaveLength(1);

      const tooHigh = await service.listTransactions('ch-1', { limit: 9999 });
      expect(mockPointTxnRepo.findByChapterFiltered).toHaveBeenLastCalledWith(
        'ch-1',
        expect.objectContaining({ limit: 200 }),
      );
      expect(tooHigh).toHaveLength(5);
    });
  });
});
