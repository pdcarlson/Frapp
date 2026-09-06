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

/**
 * Thrown by `IPointTransactionRepository.create` when the partial unique index
 * `idx_point_transactions_dedupe` rejects the insert — i.e. this
 * `(chapter_id, client_message_id)` pair already has a ledger row.
 *
 * Callers must re-select the original via `findByClientMessageId` and return
 * it, never surface this to the client: a replay is a success, not a conflict.
 * Mirrors `ChatMessageDuplicateError` in `chat.repository.interface.ts`, which
 * solves the identical problem for `chat_messages`.
 */
export class PointTransactionDuplicateError extends Error {
  constructor(
    public readonly chapter_id: string,
    public readonly client_message_id: string,
  ) {
    super('Duplicate point_transactions insert (client_message_id collision)');
    this.name = 'PointTransactionDuplicateError';
  }
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
  /**
   * @throws {PointTransactionDuplicateError} when `data.client_message_id` is
   * set and this chapter already holds a row for it.
   */
  create(data: Partial<PointTransaction>): Promise<PointTransaction>;
  /**
   * The original row for an idempotency key, or `null` if this key has not
   * been used in this chapter. Chapter-scoped because the unique index is.
   */
  findByClientMessageId(
    chapterId: string,
    clientMessageId: string,
  ): Promise<PointTransaction | null>;
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
