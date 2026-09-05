import type { PointCategory } from '../entities/point-transaction.entity';
import { PointTransaction } from '../entities/point-transaction.entity';

export const POINT_TRANSACTION_REPOSITORY = 'POINT_TRANSACTION_REPOSITORY';

/**
 * Time bounds for a leaderboard aggregation, applied in Postgres.
 *
 * Resolved by the caller from the `all | semester | month` window enum or an
 * explicit semester archive, so the boundary definition stays in one place
 * (`domain/utils/points-window.ts`) and is shared with the points report. An
 * omitted bound means unbounded on that side — which is how both the all-time
 * window and a `semester` window on a chapter with no archive arrive here.
 */
export interface PointsLeaderboardWindow {
  /** ISO timestamp; only rows strictly newer than this instant are counted. */
  since?: string;
  /** ISO timestamp; only rows at or older than this instant are counted. */
  until?: string;
}

/** One member's summed points for the requested window. */
export interface PointsLeaderboardRow {
  user_id: string;
  total: number;
}

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
  /**
   * Per-member point totals for the chapter, summed in Postgres.
   *
   * Replaces the former `findByChapter` + reduce-in-Node leaderboard path
   * (#522): the result is one row per member rather than one per transaction,
   * so neither the query nor the API process scales with chapter history.
   * Ordered by total descending, then `user_id` ascending.
   */
  leaderboard(
    chapterId: string,
    window: PointsLeaderboardWindow,
  ): Promise<PointsLeaderboardRow[]>;
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
