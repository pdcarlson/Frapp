import type { AiCallDescriptor } from '../adapters/ai-call-context';
import type { AiUsageRecord } from '../adapters/ai-usage-recorder.interface';

export const AI_USAGE_REPOSITORY = 'AI_USAGE_REPOSITORY';

/** Which cap a hold would cross. */
export type AiSpendCap = 'platform_cap' | 'chapter_cap' | 'member_cap';

/**
 * The three caps a hold is checked against, in millionths of a US dollar.
 * Null is no cap.
 */
export interface AiSpendCaps {
  /** The chapter's calendar month (UTC). */
  chapterMonthlyMicroUsd: number | null;
  /** The acting member's day (UTC) in that chapter. */
  memberDailyMicroUsd: number | null;
  /** The provider's calendar month (UTC), across every chapter. */
  platformMonthlyMicroUsd: number | null;
}

export type AiSpendHoldResult =
  | {
      granted: true;
      reservationId: string;
      /** The provider's month before and after this hold, for the pool alerts. */
      platformSpentBeforeMicroUsd: number;
      platformSpentAfterMicroUsd: number;
    }
  | { granted: false; cap: AiSpendCap };

/** What settling a usage record did. */
export type AiSpendSettleResult = 'settled' | 'inserted' | 'missing';

/** One line of a chapter's usage in a period. */
export interface AiChapterUsageLine {
  task: string;
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Seconds of audio transcribed (#712); zero for every other task. */
  audioSeconds: number;
  /** Holds not yet settled count at their hold, as the caps do. */
  costMicroUsd: number;
  /** The part of `costMicroUsd` that is a hold, not a provider's count. */
  estimatedCostMicroUsd: number;
  /** Calls still held, or whose hold expired. */
  unsettledCalls: number;
}

/**
 * `ai_usage_events`, the AI spend ledger (#714). Every write is a database
 * function in `20261112165020_ai_usage_ledger.sql`, so the cap check and the
 * insert are one transaction and the PGlite gate runs the exact SQL.
 */
export interface IAiUsageRepository {
  /** Holds `costMicroUsd` against the caps, or names the cap it would cross. */
  reserve(
    call: AiCallDescriptor,
    costMicroUsd: number,
    caps: AiSpendCaps,
    now: Date,
  ): Promise<AiSpendHoldResult>;

  /**
   * Replaces a hold with the call's real counts and cost, or records a call
   * that held nothing. `billReservation` charges the hold itself, marked as
   * an estimate, for a call whose provider never said what it used.
   */
  settle(
    usage: AiUsageRecord,
    billReservation: boolean,
    now: Date,
  ): Promise<AiSpendSettleResult>;

  /** Marks holds made before `olderThan` expired. Returns how many. */
  expireHolds(olderThan: Date): Promise<number>;

  /** A chapter's usage in `[from, to)`, one line per task, provider and model. */
  chapterUsage(
    chapterId: string,
    from: Date,
    to: Date,
  ): Promise<AiChapterUsageLine[]>;
}
