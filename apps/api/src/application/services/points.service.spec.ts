import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { PointsService } from './points.service';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';
import {
  POINT_TRANSACTION_REPOSITORY,
  IPointTransactionRepository,
  type PointsLeaderboardRow,
  type PointsLeaderboardWindow,
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
import {
  ChapterPointsConfigService,
  POINTS_CONFIG_DEFAULTS,
} from './chapter-points-config.service';

/**
 * A stand-in for `get_points_leaderboard`, used to test the SERVICE.
 *
 * The sum moved into Postgres (#522), so the service no longer sees
 * transactions — it computes `(since, until]` bounds and hands them to the
 * repository. Asserting only "was called with these bounds" would leave the
 * *meaning* of those bounds untested, and the rules are subtle: exclusive
 * lower, inclusive upper, and either side unbounded when omitted. So the tests
 * keep their transaction fixtures and this applies the bounds to them.
 *
 * **What this does NOT do is test the SQL.** It is a transcription, and a
 * transcription cannot catch a divergence between itself and the migration —
 * flip `>` to `>=` in the .sql file and every test here still passes. The real
 * function is covered against a live database in
 * `test/integration/points-leaderboard.integration-spec.ts`; that suite, not
 * this fake, is what makes the SQL's boundary behaviour a tested claim.
 */
const applyLeaderboardBounds = (
  transactions: PointTransaction[],
  chapterId: string,
  { since, until }: PointsLeaderboardWindow,
): PointsLeaderboardRow[] => {
  const sinceMs = since === undefined ? null : new Date(since).getTime();
  const untilMs = until === undefined ? null : new Date(until).getTime();

  const totals = new Map<string, number>();
  for (const txn of transactions) {
    // The SQL's first predicate. Mirrored so a fixture row planted in another
    // chapter stays out of the board here too, rather than the fake being
    // laxer than the thing it stands in for.
    if (txn.chapter_id !== chapterId) continue;
    const at = new Date(txn.created_at).getTime();
    if (sinceMs !== null && !(at > sinceMs)) continue; // exclusive lower
    if (untilMs !== null && !(at <= untilMs)) continue; // inclusive upper
    totals.set(txn.user_id, (totals.get(txn.user_id) ?? 0) + txn.amount);
  }

  return Array.from(totals.entries())
    .map(([user_id, total]) => ({ user_id, total }))
    .sort((a, b) => b.total - a.total || a.user_id.localeCompare(b.user_id));
};

describe('PointsService', () => {
  let service: PointsService;
  let mockPointTxnRepo: jest.Mocked<IPointTransactionRepository>;
  let mockSemesterArchiveRepo: jest.Mocked<ISemesterArchiveRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockChatService: jest.Mocked<Pick<ChatService, 'sendMessage'>>;
  let mockChapterPointsConfig: jest.Mocked<
    Pick<ChapterPointsConfigService, 'getConfig'>
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

  /**
   * Give the chapter these transactions. The repository mock then aggregates
   * them under whatever bounds the service actually computed, so a test's
   * fixtures still decide the board.
   */
  const seedTransactions = (transactions: PointTransaction[]) => {
    mockPointTxnRepo.leaderboard.mockImplementation((chapterId, window) =>
      Promise.resolve(applyLeaderboardBounds(transactions, chapterId, window)),
    );
  };

  beforeEach(async () => {
    mockPointTxnRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      leaderboard: jest.fn().mockResolvedValue([]),
      findByChapterFiltered: jest.fn(),
      countRecentAdjustments: jest.fn().mockResolvedValue(0),
    };

    mockSemesterArchiveRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findLatestByChapter: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
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

    // Default posture for every existing test: a chapter with no
    // `chapter_points_config` row, which resolves to the values this service
    // hardcoded before #394 (50/hr, flag at +/-100). Tests that care about a
    // configured chapter override this per-case.
    mockChapterPointsConfig = {
      getConfig: jest.fn().mockResolvedValue({ ...POINTS_CONFIG_DEFAULTS }),
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
        {
          provide: ChapterPointsConfigService,
          useValue: mockChapterPointsConfig,
        },
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

    describe('semester_archive_id (#377)', () => {
      const archive = {
        id: 'sa-1',
        chapter_id: 'ch-1',
        label: 'Spring 2026',
        start_date: '2026-01-15',
        end_date: '2026-06-15',
        created_at: '2026-06-15T12:00:00.000Z',
      };

      it('overrides `window` and filters to the archive’s own [start_date, end_date] range', async () => {
        mockSemesterArchiveRepo.findById.mockResolvedValue(archive);
        const inRange: PointTransaction = {
          ...txn1,
          created_at: '2026-06-15T18:00:00.000Z', // on end_date day
        };
        const beforeRange: PointTransaction = {
          ...txn1b,
          created_at: '2026-01-14T23:59:59.999Z', // day before start_date
        };
        mockPointTxnRepo.findByUser.mockResolvedValue([inRange, beforeRange]);

        // window: 'all' would normally return both — semester_archive_id wins.
        const result = await service.getUserSummary(
          'ch-1',
          'user-1',
          'all',
          'sa-1',
        );

        expect(mockSemesterArchiveRepo.findById).toHaveBeenCalledWith(
          'sa-1',
          'ch-1',
        );
        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].id).toBe('pt-1');
      });

      it('throws NotFoundException for an archive id that is unknown or belongs to another chapter', async () => {
        mockSemesterArchiveRepo.findById.mockResolvedValue(null);

        await expect(
          service.getUserSummary('ch-1', 'user-1', 'all', 'not-a-real-id'),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('getLeaderboard', () => {
    it('should return sorted leaderboard by total points', async () => {
      seedTransactions([txn1, txn2, txn3]);

      const result = await service.getLeaderboard('ch-1', 'all');

      // All-time asks Postgres for no bounds at all — not "bounded by now",
      // which would newly exclude any future-dated row.
      expect(mockPointTxnRepo.leaderboard).toHaveBeenCalledWith('ch-1', {});
      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe('user-2');
      expect(result[0].total).toBe(25);
      expect(result[1].user_id).toBe('user-1');
      expect(result[1].total).toBe(10);
    });

    it('should return empty array when no transactions', async () => {
      seedTransactions([]);

      const result = await service.getLeaderboard('ch-1');

      expect(result).toEqual([]);
    });

    it('filters to a semester_archive_id, reproducing that period’s totals regardless of `window`', async () => {
      mockSemesterArchiveRepo.findById.mockResolvedValue({
        id: 'sa-1',
        chapter_id: 'ch-1',
        label: 'Spring 2026',
        start_date: '2026-01-15',
        end_date: '2026-06-15',
        created_at: '2026-06-15T12:00:00.000Z',
      });
      const inRange: PointTransaction = {
        ...txn1,
        created_at: '2026-03-01T00:00:00.000Z',
      };
      const outOfRange: PointTransaction = {
        ...txn2,
        created_at: '2026-07-01T00:00:00.000Z',
      };
      seedTransactions([inRange, outOfRange]);

      const result = await service.getLeaderboard('ch-1', 'all', 'sa-1');

      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe(txn1.user_id);
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

    // #394 — both anti-fraud limits are chapter-configurable
    // (spec/behavior/points.md § Anti-Fraud). The cases above cover the
    // unconfigured chapter, which resolves to the defaults; these cover a
    // chapter that has set its own.
    describe('chapter-configurable anti-fraud limits', () => {
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

      const adjust = (amount = 10) =>
        service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'user-2',
          adminUserId: 'admin-1',
          amount,
          category: 'MANUAL',
          reason: 'Bonus',
        });

      it('reads the limits for the acting chapter', async () => {
        mockPointTxnRepo.create.mockResolvedValue(created);

        await adjust();

        expect(mockChapterPointsConfig.getConfig).toHaveBeenCalledWith('ch-1');
      });

      it('enforces a configured rate limit tighter than the default', async () => {
        mockChapterPointsConfig.getConfig.mockResolvedValue({
          ...POINTS_CONFIG_DEFAULTS,
          adjustment_rate_limit_per_hour: 5,
        });
        // Well under the default 50, so this can only fail on the configured
        // value — the assertion would pass vacuously against the old constant.
        mockPointTxnRepo.countRecentAdjustments.mockResolvedValue(5);

        await expect(adjust()).rejects.toMatchObject({
          status: 429,
          message: 'Rate limit exceeded: maximum 5 point adjustments per hour',
        });
        expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      });

      it('allows past the default when a chapter configures a looser rate limit', async () => {
        mockChapterPointsConfig.getConfig.mockResolvedValue({
          ...POINTS_CONFIG_DEFAULTS,
          adjustment_rate_limit_per_hour: 200,
        });
        // Above the old hardcoded 50, so this fails against the constant.
        mockPointTxnRepo.countRecentAdjustments.mockResolvedValue(120);
        mockPointTxnRepo.create.mockResolvedValue(created);

        await expect(adjust()).resolves.toEqual(created);
      });

      it('flags on a configured threshold below the default', async () => {
        mockChapterPointsConfig.getConfig.mockResolvedValue({
          ...POINTS_CONFIG_DEFAULTS,
          anomaly_threshold: 25,
        });
        mockPointTxnRepo.create.mockResolvedValue(created);

        // 30 is under the default 100 and over the configured 25.
        await adjust(30);

        expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({ flagged: true }),
          }),
        );
      });

      it('does not flag under a configured threshold above the default', async () => {
        mockChapterPointsConfig.getConfig.mockResolvedValue({
          ...POINTS_CONFIG_DEFAULTS,
          anomaly_threshold: 500,
        });
        mockPointTxnRepo.create.mockResolvedValue(created);

        // 150 flags under the default 100 but not under the configured 500.
        await adjust(150);

        const metadata = mockPointTxnRepo.create.mock.calls[0]?.[0]
          ?.metadata as Record<string, unknown>;
        expect(metadata.flagged).toBeUndefined();
      });

      it('flags exactly at the configured threshold, not only above it', async () => {
        mockChapterPointsConfig.getConfig.mockResolvedValue({
          ...POINTS_CONFIG_DEFAULTS,
          anomaly_threshold: 40,
        });
        mockPointTxnRepo.create.mockResolvedValue(created);

        await adjust(40);

        expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({ flagged: true }),
          }),
        );
      });

      it('applies the threshold to the absolute amount, so a large FINE flags too', async () => {
        mockChapterPointsConfig.getConfig.mockResolvedValue({
          ...POINTS_CONFIG_DEFAULTS,
          anomaly_threshold: 25,
        });
        mockPointTxnRepo.create.mockResolvedValue(created);

        await adjust(-30);

        expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({ flagged: true }),
          }),
        );
      });
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
      seedTransactions([active, onEndDateDay, beforeEnd, future]);

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
      seedTransactions([lastInstantOfEndDay, firstInstantOfNextDay]);

      const result = await service.getLeaderboard('ch-1', 'semester');

      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe('user-1');
    });

    it('should fall back to all-time when no archive exists', async () => {
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue(null);
      seedTransactions([txn1, txn2, txn3]);

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
      seedTransactions([txn1, txn2, txn3]);

      const result = await service.getLeaderboard('ch-1', 'semester');

      // Unparseable end_date → getSemesterRange returns undefined → all-time.
      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe('user-2');
      expect(result[0].total).toBe(25);
    });

    it('asks for no bounds at all when no archive exists, rather than bounding by now', async () => {
      // The distinction this pins: 'semester' with no archive falls back to
      // ALL-TIME, which the old in-Node filter expressed by returning the list
      // untouched. Bounding it by `now` instead would look equivalent on
      // ordinary data and silently drop future-dated rows.
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue(null);
      seedTransactions([txn1, txn2, txn3]);

      await service.getLeaderboard('ch-1', 'semester');

      expect(mockPointTxnRepo.leaderboard).toHaveBeenCalledWith('ch-1', {});
    });
  });

  describe('leaderboard parity with the pre-#522 in-Node aggregation', () => {
    /**
     * The aggregation this replaced, verbatim in shape: load every transaction
     * in the chapter, filter it in JavaScript, reduce into a Map, sort by total
     * descending. Kept here as the oracle so "identical totals to the current
     * implementation" is a test rather than a claim in a PR body.
     */
    const legacyLeaderboard = (
      transactions: PointTransaction[],
      bounds: { since?: Date; until?: Date },
    ) => {
      const filtered = transactions.filter((txn) => {
        const createdAt = new Date(txn.created_at);
        if (Number.isNaN(createdAt.getTime())) return false;
        if (bounds.since && !(createdAt > bounds.since)) return false;
        if (bounds.until && !(createdAt <= bounds.until)) return false;
        return true;
      });

      const totals = new Map<string, number>();
      for (const txn of filtered) {
        totals.set(txn.user_id, (totals.get(txn.user_id) ?? 0) + txn.amount);
      }
      return Array.from(totals.entries()).map(([user_id, total]) => ({
        user_id,
        total,
      }));
    };

    /** Deterministic pseudo-random source, so a failure is reproducible. */
    const lcg = (seed: number) => () =>
      ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 8) / 0x7fffff;

    const NOW = new Date('2027-01-10T00:00:00.000Z');
    const ARCHIVE_END = '2026-06-15';

    /** ~2,000 transactions across 40 members, spread over three years. */
    const buildLargeFixture = (): PointTransaction[] => {
      const rand = lcg(20260522);
      const start = new Date('2025-01-01T00:00:00.000Z').getTime();
      const span = new Date('2027-06-01T00:00:00.000Z').getTime() - start;

      return Array.from({ length: 2000 }, (_, i) => ({
        id: `pt-${i}`,
        chapter_id: 'ch-1',
        // 40 members, so plenty of rows share a user AND plenty of members
        // land on identical totals — which is where ordering could differ.
        user_id: `user-${Math.floor(rand() * 40)}`,
        // Small integer amounts, some negative (fines are allowed to push a
        // balance negative per spec/behavior/points.md § Edge Cases).
        amount: Math.floor(rand() * 21) - 5,
        category: 'MANUAL' as const,
        description: `txn ${i}`,
        metadata: {},
        created_at: new Date(start + rand() * span).toISOString(),
      }));
    };

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW);
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it.each([
      ['all', undefined],
      ['month', undefined],
      ['semester', undefined],
      ['all', 'sa-1'],
    ] as const)(
      'reproduces the old totals exactly (window=%s, archive=%s)',
      async (window, archiveId) => {
        const transactions = buildLargeFixture();
        seedTransactions(transactions);

        const archive = {
          id: 'sa-1',
          chapter_id: 'ch-1',
          label: 'Spring 2026',
          start_date: '2026-01-15',
          end_date: ARCHIVE_END,
          created_at: '2026-06-15T12:00:00.000Z',
        };
        mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue(archive);
        mockSemesterArchiveRepo.findById.mockResolvedValue(archive);

        // The bounds the pre-#522 code would have filtered by, derived
        // independently of the service rather than read back off the mock.
        const endOfArchiveDay = new Date(`${ARCHIVE_END}T23:59:59.999Z`);
        const oneMonthAgo = new Date(NOW);
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

        let legacyBounds: { since?: Date; until?: Date };
        if (archiveId) {
          legacyBounds = {
            since: new Date('2026-01-14T23:59:59.999Z'),
            until: endOfArchiveDay,
          };
        } else if (window === 'month') {
          legacyBounds = { since: oneMonthAgo, until: NOW };
        } else if (window === 'semester') {
          legacyBounds = { since: endOfArchiveDay, until: NOW };
        } else {
          legacyBounds = {};
        }

        const expected = legacyLeaderboard(transactions, legacyBounds);
        const actual = await service.getLeaderboard('ch-1', window, archiveId);

        // Same members, same totals. Compared as maps because the new path
        // breaks equal-total ties by user_id where the old one used the
        // incidental `created_at desc` arrival order.
        expect(
          Object.fromEntries(actual.map((r) => [r.user_id, r.total])),
        ).toEqual(
          Object.fromEntries(expected.map((r) => [r.user_id, r.total])),
        );
        expect(actual.length).toBe(expected.length);
        expect(actual.length).toBeGreaterThan(0);
      },
    );

    it('ranks by total descending, breaking ties by user_id', async () => {
      seedTransactions(buildLargeFixture());

      const result = await service.getLeaderboard('ch-1', 'all');

      for (let i = 1; i < result.length; i++) {
        const prev = result[i - 1];
        const cur = result[i];
        expect(prev.total).toBeGreaterThanOrEqual(cur.total);
        if (prev.total === cur.total) {
          expect(prev.user_id.localeCompare(cur.user_id)).toBeLessThan(0);
        }
      }
    });

    it('reads the board with exactly one aggregated call', async () => {
      seedTransactions(buildLargeFixture());
      await service.getLeaderboard('ch-1', 'all');

      expect(mockPointTxnRepo.leaderboard).toHaveBeenCalledTimes(1);
    });

    it('leaves no unbounded chapter read on the real repository', () => {
      // The whole point of #522: no seam remains through which the service can
      // pull every transaction in the chapter.
      //
      // Asserted against the REAL repository's prototype, not the mock literal
      // in this file. The mock would satisfy a `findByChapter === undefined`
      // check simply by never listing the key, so that assertion would keep
      // passing after someone re-added the method to the interface and the
      // implementation — which is precisely the regression it exists to catch.
      const methods = Object.getOwnPropertyNames(
        SupabasePointTransactionRepository.prototype,
      );

      expect(methods).toContain('leaderboard');
      expect(methods).not.toContain('findByChapter');
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
