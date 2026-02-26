import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import type {
  PointTransaction,
  PointCategory,
} from '../../domain/entities/point-transaction.entity';

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
  ) {}

  private filterByWindow(
    transactions: PointTransaction[],
    window: PointsWindow = 'all',
  ): PointTransaction[] {
    if (window === 'all') return transactions;

    const now = new Date();
    let from: Date;

    if (window === 'month') {
      from = new Date(now);
      from.setMonth(from.getMonth() - 1);
    } else {
      // semester: use a 6-month rolling window as an approximation
      from = new Date(now);
      from.setMonth(from.getMonth() - 6);
    }

    return transactions.filter((txn) => {
      const createdAt = new Date(txn.created_at);
      return (
        !Number.isNaN(createdAt.getTime()) &&
        createdAt >= from &&
        createdAt <= now
      );
    });
  }

  async getUserSummary(
    chapterId: string,
    userId: string,
    window: PointsWindow = 'all',
  ): Promise<{ balance: number; transactions: PointTransaction[] }> {
    const txns = await this.pointTxnRepo.findByUser(chapterId, userId);
    const filtered = this.filterByWindow(txns, window);
    const balance = filtered.reduce((sum, txn) => sum + txn.amount, 0);

    return { balance, transactions: filtered };
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
    const filtered = this.filterByWindow(txns, window);

    const totals = new Map<string, number>();
    for (const txn of filtered) {
      const prev = totals.get(txn.user_id) ?? 0;
      totals.set(txn.user_id, prev + txn.amount);
    }

    return Array.from(totals.entries())
      .map(([user_id, total]) => ({ user_id, total }))
      .sort((a, b) => b.total - a.total);
  }

  async adjustPoints(input: AdjustPointsInput): Promise<PointTransaction> {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new BadRequestException('Reason is required for point adjustments');
    }

    if (input.adminUserId === input.targetUserId) {
      throw new ForbiddenException('Admins cannot adjust their own points');
    }

    const metadata: Record<string, unknown> = {
      adjusted_by: input.adminUserId,
      reason: input.reason,
    };

    const anomalyThreshold = 100;
    if (Math.abs(input.amount) >= anomalyThreshold) {
      metadata.flagged = true;
    }

    return this.pointTxnRepo.create({
      chapter_id: input.chapterId,
      user_id: input.targetUserId,
      amount: input.amount,
      category: input.category,
      description: input.reason,
      metadata,
    });
  }
}
