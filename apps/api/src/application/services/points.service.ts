import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import type {
  PointTransaction,
  PointCategory,
} from '../../domain/entities/point-transaction.entity';
import { NotificationService } from './notification.service';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '../../domain/constants/list-query-limits';

export type PointsWindow = 'all' | 'semester' | 'month';

interface AdjustPointsInput {
  chapterId: string;
  targetUserId: string;
  adminUserId: string;
  amount: number;
  category: Extract<PointCategory, 'MANUAL' | 'FINE'>;
  reason: string;
}

@Injectable()
export class PointsService {
  constructor(
    @Inject(POINT_TRANSACTION_REPOSITORY)
    private readonly pointTxnRepo: IPointTransactionRepository,
    @Inject(SEMESTER_ARCHIVE_REPOSITORY)
    private readonly semesterArchiveRepo: ISemesterArchiveRepository,
    private readonly notificationService: NotificationService,
  ) {}

  private filterByWindow(
    transactions: PointTransaction[],
    window: PointsWindow = 'all',
    semesterRange?: { start: Date; end: Date },
  ): PointTransaction[] {
    if (window === 'all') return transactions;

    const now = new Date();
    let from: Date;
    let to: Date = now;

    if (window === 'month') {
      from = new Date(now);
      from.setMonth(from.getMonth() - 1);
    } else if (semesterRange) {
      from = semesterRange.start;
      to = semesterRange.end;
    } else {
      return transactions;
    }

    return transactions.filter((txn) => {
      const createdAt = new Date(txn.created_at);
      return (
        !Number.isNaN(createdAt.getTime()) &&
        createdAt >= from &&
        createdAt <= to
      );
    });
  }

  private async getSemesterRange(
    chapterId: string,
  ): Promise<{ start: Date; end: Date } | undefined> {
    const archive =
      await this.semesterArchiveRepo.findLatestByChapter(chapterId);
    if (!archive) return undefined;
    return {
      start: new Date(archive.start_date),
      end: new Date(archive.end_date),
    };
  }

  async getUserSummary(
    chapterId: string,
    userId: string,
    window: PointsWindow = 'all',
  ): Promise<{ balance: number; transactions: PointTransaction[] }> {
    const txns = await this.pointTxnRepo.findByUser(chapterId, userId);
    const semesterRange =
      window === 'semester'
        ? await this.getSemesterRange(chapterId)
        : undefined;
    const filtered = this.filterByWindow(txns, window, semesterRange);
    const balance = filtered.reduce((sum, txn) => sum + txn.amount, 0);

    return { balance, transactions: filtered };
  }

  /**
   * Chapter-wide transaction list for the points admin Audit tab.
   *
   * Filters (user, category, flagged, `before` cursor), sort (newest first),
   * and limit are applied in Postgres via `findByChapterFiltered`, so work and
   * memory scale with the page size rather than full chapter history.
   */
  async listTransactions(
    chapterId: string,
    options: {
      userId?: string;
      category?: PointCategory;
      flagged?: boolean;
      before?: string;
      limit?: number;
    } = {},
  ): Promise<PointTransaction[]> {
    const limit = Math.max(
      LIST_QUERY_LIMIT_MIN,
      Math.min(options.limit ?? LIST_QUERY_LIMIT_DEFAULT, LIST_QUERY_LIMIT_MAX),
    );

    let beforeIso: string | undefined;
    if (options.before) {
      const parsed = new Date(options.before);
      if (!Number.isNaN(parsed.getTime())) {
        beforeIso = parsed.toISOString();
      }
    }

    return this.pointTxnRepo.findByChapterFiltered(chapterId, {
      userId: options.userId,
      category: options.category,
      flagged: options.flagged,
      before: beforeIso,
      limit,
    });
  }

  async getLeaderboard(
    chapterId: string,
    window: PointsWindow = 'all',
  ): Promise<
    {
      user_id: string;
      total: number;
    }[]
  > {
    const txns = await this.pointTxnRepo.findByChapter(chapterId);
    const semesterRange =
      window === 'semester'
        ? await this.getSemesterRange(chapterId)
        : undefined;
    const filtered = this.filterByWindow(txns, window, semesterRange);

    const totals = new Map<string, number>();
    for (const txn of filtered) {
      const prev = totals.get(txn.user_id) ?? 0;
      totals.set(txn.user_id, prev + txn.amount);
    }

    return Array.from(totals.entries())
      .map(([user_id, total]) => ({ user_id, total }))
      .sort((a, b) => b.total - a.total);
  }

  private static readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
  private static readonly RATE_LIMIT_MAX = 50;

  async adjustPoints(input: AdjustPointsInput): Promise<PointTransaction> {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new BadRequestException('Reason is required for point adjustments');
    }

    if (input.adminUserId === input.targetUserId) {
      throw new ForbiddenException('Admins cannot adjust their own points');
    }

    const since = new Date(Date.now() - PointsService.RATE_LIMIT_WINDOW_MS);
    const recentCount = await this.pointTxnRepo.countRecentAdjustments(
      input.adminUserId,
      input.chapterId,
      since,
    );
    if (recentCount >= PointsService.RATE_LIMIT_MAX) {
      throw new HttpException(
        'Rate limit exceeded: maximum 50 point adjustments per hour',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const metadata: Record<string, unknown> = {
      adjusted_by: input.adminUserId,
      reason: input.reason,
    };

    const anomalyThreshold = 100;
    if (Math.abs(input.amount) >= anomalyThreshold) {
      metadata.flagged = true;
    }

    const txn = await this.pointTxnRepo.create({
      chapter_id: input.chapterId,
      user_id: input.targetUserId,
      amount: input.amount,
      category: input.category,
      description: input.reason,
      metadata,
    });

    try {
      const isFine = input.category === 'FINE' || input.amount < 0;
      await this.notificationService.notifyUser(
        input.targetUserId,
        input.chapterId,
        {
          title: isFine ? 'Points Deducted' : 'Points Awarded',
          body: isFine
            ? `You were fined ${Math.abs(input.amount)} points: ${input.reason}`
            : `You received ${input.amount} points: ${input.reason}`,
          priority: 'NORMAL',
          category: 'points',
          data: { target: { screen: 'points' } },
        },
      );
    } catch {}

    return txn;
  }
}
