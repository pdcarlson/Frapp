import type { PointCategory } from '../entities/point-transaction.entity';
import { PointTransaction } from '../entities/point-transaction.entity';

export const POINT_TRANSACTION_REPOSITORY = 'POINT_TRANSACTION_REPOSITORY';

/** Filters for chapter-scoped point transaction lists (audit); applied in Postgres. */
export interface ListChapterPointTransactionsOptions {
  userId?: string;
  category?: PointCategory;
  /** When true, only rows with `metadata.flagged === true`. When false, excludes those rows. */
  flagged?: boolean;
  /** ISO timestamp; only rows strictly older than this instant are returned. */
  before?: string;
  limit: number;
}

export interface IPointTransactionRepository {
  create(data: Partial<PointTransaction>): Promise<PointTransaction>;
  findByUser(chapterId: string, userId: string): Promise<PointTransaction[]>;
  findByChapter(chapterId: string): Promise<PointTransaction[]>;
  findByChapterFiltered(
    chapterId: string,
    options: ListChapterPointTransactionsOptions,
  ): Promise<PointTransaction[]>;
  countRecentAdjustments(
    adminUserId: string,
    chapterId: string,
    since: Date,
  ): Promise<number>;
}
