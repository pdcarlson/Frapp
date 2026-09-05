import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { PointsService } from './points.service';
import {
  POINT_TRANSACTION_REPOSITORY,
  IPointTransactionRepository,
  PointTransactionDuplicateError,
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

  beforeEach(async () => {
    mockPointTxnRepo = {
      create: jest.fn(),
      findByClientMessageId: jest.fn().mockResolvedValue(null),
      findByUser: jest.fn(),
      findByChapter: jest.fn(),
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
      mockPointTxnRepo.findByChapter.mockResolvedValue([inRange, outOfRange]);

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
        // No key was supplied (a dashboard adjustment), so the row is written
        // with an explicit null and is not covered by the dedupe index.
        client_message_id: null,
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

    // #1719: the ledger is append-only, so a retried adjustment that writes a
    // second row is unrecoverable through the API. These cover the two ways a
    // replay can arrive — one after the first attempt finished, one racing it.
    describe('idempotency on client_message_id', () => {
      const original: PointTransaction = {
        id: 'pt-original',
        chapter_id: 'ch-1',
        user_id: 'user-2',
        amount: 5,
        category: 'MANUAL',
        description: 'great work',
        metadata: { adjusted_by: 'admin-1', reason: 'great work' },
        client_message_id: 'cmid-replay',
        created_at: '2026-02-26T20:00:00.000Z',
      };

      const replay = () =>
        service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'user-2',
          adminUserId: 'admin-1',
          amount: 5,
          category: 'MANUAL',
          reason: 'great work',
          channelId: 'chan-1',
          clientMessageId: 'cmid-replay',
        });

      it('commit-then-lost-response: the replay writes exactly one ledger row', async () => {
        // The first attempt committed; its 200 never reached the officer, who
        // retried with the same key. The pre-check finds the original.
        mockPointTxnRepo.findByClientMessageId.mockResolvedValue(original);

        const result = await replay();

        expect(result).toBe(original);
        expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
        // Pin the argument ORDER, not just the call. Both parameters are
        // strings, so swapping them typechecks; in production every pre-check
        // would then miss, the dedupe would silently never fire, and duplicate
        // grants would come straight back with every test still green.
        expect(mockPointTxnRepo.findByClientMessageId).toHaveBeenCalledWith(
          'ch-1',
          'cmid-replay',
        );
      });

      it('a replay does not re-send the non-idempotent push notification', async () => {
        mockPointTxnRepo.findByClientMessageId.mockResolvedValue(original);

        await replay();

        // Re-notifying would just move the duplicate from the ledger to the
        // member's phone.
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('a replay DOES re-attempt the chat card, which is idempotent', async () => {
        // The first attempt's card post is best-effort and may have failed
        // after the ledger row committed. Skipping it on the replay would make
        // that card permanently unrecoverable — a real transaction with no
        // audit card, and a client placeholder no echo ever reconciles.
        // `sendMessage` dedupes on the same key, so this cannot double-post.
        mockPointTxnRepo.findByClientMessageId.mockResolvedValue(original);

        await replay();

        expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
        expect(mockChatService.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'points',
            client_message_id: 'cmid-replay',
            payload: expect.objectContaining({ transaction_id: 'pt-original' }),
          }),
        );
      });

      it('a dashboard replay posts no card (no channel to post into)', async () => {
        mockPointTxnRepo.findByClientMessageId.mockResolvedValue(original);

        await service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'user-2',
          adminUserId: 'admin-1',
          amount: 5,
          category: 'MANUAL',
          reason: 'great work',
          clientMessageId: 'cmid-replay',
        });

        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });

      describe('a key reused for a DIFFERENT adjustment is refused, never answered', () => {
        // The index is chapter-scoped and the key is client-supplied, so a
        // colliding or replayed key can name another member's row. Returning it
        // would report "granted" while writing nothing and discarding the
        // adjustment actually requested — a 200 carrying someone else's data.
        beforeEach(() => {
          mockPointTxnRepo.findByClientMessageId.mockResolvedValue(original);
        });

        const withOverrides = (overrides: Record<string, unknown>) =>
          service.adjustPoints({
            chapterId: 'ch-1',
            targetUserId: 'user-2',
            adminUserId: 'admin-1',
            amount: 5,
            category: 'MANUAL',
            reason: 'great work',
            channelId: 'chan-1',
            clientMessageId: 'cmid-replay',
            ...overrides,
          });

        it.each([
          ['a different target member', { targetUserId: 'user-3' }],
          ['a different amount', { amount: 50 }],
          ['a different category', { category: 'FINE' as const }],
          ['a different reason', { reason: 'something else' }],
          ['a different acting admin', { adminUserId: 'admin-9' }],
        ])('409s on %s', async (_label, overrides) => {
          await expect(withOverrides(overrides)).rejects.toBeInstanceOf(
            ConflictException,
          );
          expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
          expect(mockChatService.sendMessage).not.toHaveBeenCalled();
        });
      });

      it('a racing replay is not refused 429 for an adjustment that committed', async () => {
        // The twin committed between the pre-check and the rate-limit count, so
        // the count now reads at the ceiling. Reporting 429 would tell the
        // officer the grant was refused when it had in fact landed.
        mockChapterPointsConfig.getConfig.mockResolvedValue({
          adjustment_rate_limit_per_hour: 50,
          anomaly_threshold: 100,
        });
        mockPointTxnRepo.countRecentAdjustments.mockResolvedValue(50);
        mockPointTxnRepo.findByClientMessageId
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(original);

        const result = await replay();

        expect(result).toBe(original);
        expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      });

      it('still refuses 429 when the ceiling is real and no replay exists', async () => {
        mockChapterPointsConfig.getConfig.mockResolvedValue({
          adjustment_rate_limit_per_hour: 50,
          anomaly_threshold: 100,
        });
        mockPointTxnRepo.countRecentAdjustments.mockResolvedValue(50);
        mockPointTxnRepo.findByClientMessageId.mockResolvedValue(null);

        await expect(replay()).rejects.toMatchObject({ status: 429 });
      });

      it('a replay short-circuits before the rate-limit read', async () => {
        // Not because a replay would otherwise consume budget — the budget is
        // counted from committed rows and a replay writes none either way — but
        // because reaching the limit check first lets an officer at the ceiling
        // be told 429 for a grant that already landed.
        mockPointTxnRepo.findByClientMessageId.mockResolvedValue(original);

        await replay();

        expect(mockPointTxnRepo.countRecentAdjustments).not.toHaveBeenCalled();
      });

      it('racing replays: a unique-index violation returns the winner’s row', async () => {
        // Both requests missed the pre-check, so the partial unique index
        // arbitrated. The loser must return the committed row, not a 500.
        mockPointTxnRepo.findByClientMessageId
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(original);
        mockPointTxnRepo.create.mockRejectedValue(
          new PointTransactionDuplicateError('ch-1', 'cmid-replay'),
        );

        const result = await replay();

        expect(result).toBe(original);
        expect(mockPointTxnRepo.create).toHaveBeenCalledTimes(1);
      });

      it('rethrows a duplicate whose original cannot be read back', async () => {
        // The index fired on a row this chapter cannot see. There is nothing
        // sane to return, so it must not be reported as a successful grant.
        mockPointTxnRepo.findByClientMessageId.mockResolvedValue(null);
        mockPointTxnRepo.create.mockRejectedValue(
          new PointTransactionDuplicateError('ch-1', 'cmid-replay'),
        );

        await expect(replay()).rejects.toBeInstanceOf(
          PointTransactionDuplicateError,
        );
      });

      it('persists the key on the ledger row so a later replay can find it', async () => {
        mockPointTxnRepo.findByClientMessageId.mockResolvedValue(null);
        mockPointTxnRepo.create.mockResolvedValue(original);

        await replay();

        expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ client_message_id: 'cmid-replay' }),
        );
      });

      it('a dashboard adjustment sends no key and is not deduplicated', async () => {
        mockPointTxnRepo.create.mockResolvedValue({
          ...original,
          client_message_id: null,
        });

        await service.adjustPoints({
          chapterId: 'ch-1',
          targetUserId: 'user-2',
          adminUserId: 'admin-1',
          amount: 5,
          category: 'MANUAL',
          reason: 'great work',
        });

        // No key means no lookup — two deliberate identical grants from the
        // dashboard are two legitimate rows, not a duplicate.
        expect(mockPointTxnRepo.findByClientMessageId).not.toHaveBeenCalled();
        expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ client_message_id: null }),
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
