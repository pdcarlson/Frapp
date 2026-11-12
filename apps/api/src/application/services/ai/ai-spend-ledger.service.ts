import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiCallDescriptor } from '#domain/adapters/ai-call-context';
import type {
  AiSpendEstimate,
  AiSpendReservationResult,
  IAiSpendReservation,
} from '#domain/adapters/ai-spend-reservation.interface';
import type {
  AiUsageRecord,
  IAiUsageRecorder,
} from '#domain/adapters/ai-usage-recorder.interface';
import {
  AI_USAGE_REPOSITORY,
  type AiChapterUsageLine,
  type IAiUsageRepository,
} from '#domain/repositories/ai-usage.repository.interface';
import { aiSpendCaps } from '../../../config/ai-spend-config';
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';

/**
 * How full a provider's monthly pool is when Sentry hears about it, in percent.
 * A hold that would cross 100% is refused, and that refusal is reported on
 * its own (`ai-spend-platform-cap-reached`).
 *
 * Each line is reported once per provider and month by each API process.
 * Holds count at their worst case and settle lower, so the spend can cross a
 * line, fall back under it and cross it again many times before the settled
 * spend gets there; only the first crossing is news.
 */
export const AI_PLATFORM_POOL_ALERTS = [50, 75, 90] as const;

/**
 * Error kinds that prove the provider turned the request away before doing
 * any work: nothing was generated, so nothing was billed.
 *
 * Every other failure with no counts is charged its whole hold, marked as an
 * estimate: a stream the member stopped reading (`aborted`), a time-out, a
 * dropped connection, an overload or an unknown error can each come after
 * the provider had already written part of an answer, and the usage record
 * cannot tell a stream that had produced text from one that had not.
 * Charging the hold over-counts a call that failed early, which costs a cap
 * some room for an hour of the month; charging nothing would let spend
 * escape the caps.
 */
const DOOR_REFUSAL_KINDS: ReadonlySet<string> = new Set([
  'rate_limited',
  'auth',
  'invalid_request',
  'unsupported',
]);

/** A chapter's usage in one period, summed from the ledger. */
export interface AiChapterUsage {
  periodStart: Date;
  periodEnd: Date;
  /** Every call in the period, holds at their hold, in micro-USD. */
  totalCostMicroUsd: number;
  /** The part of the total that is a hold rather than a provider's count. */
  estimatedCostMicroUsd: number;
  lines: AiChapterUsageLine[];
}

/**
 * The AI spend ledger and caps (#714, ADR-28 decision 1): the gateway's spend
 * seam and usage seam, both backed by `ai_usage_events`.
 *
 * - **Before a call** (`reserve`): the call's worst case, which the gateway
 *   works out from the catalog, is held against three caps in one database
 *   transaction: the chapter's month, the acting member's day, and the
 *   platform's month for the provider (`config/ai-spend-config.ts`). A call
 *   that would cross one is not made.
 * - **After it** (`record`): the hold is replaced with the call's real counts
 *   and cost, before the gateway returns. A call that failed without the
 *   provider saying what it used (an abandoned stream, a time-out, a dropped
 *   connection) is charged its whole hold, marked as an estimate, unless the
 *   failure proves it was turned away at the door
 *   (`spec/behavior/billing.md` § Abandoned and unanswered calls).
 *
 * Nothing here sees a prompt or an answer: the gateway hands the seams who,
 * which task and how much, and the ledger has no text column.
 */
@Injectable()
export class AiSpendLedgerService
  implements IAiSpendReservation, IAiUsageRecorder
{
  private readonly logger = new Logger(AiSpendLedgerService.name);
  /** `provider:YYYY-MM:percent` lines already reported by this process. */
  private readonly poolLinesReported = new Set<string>();

  constructor(
    @Inject(AI_USAGE_REPOSITORY) private readonly ledger: IAiUsageRepository,
  ) {}

  async reserve(
    call: AiCallDescriptor,
    estimate: AiSpendEstimate,
  ): Promise<AiSpendReservationResult> {
    const caps = aiSpendCaps(call.provider);
    const now = new Date();
    const hold = await this.ledger.reserve(
      call,
      Math.max(0, Math.ceil(estimate.maxCostMicroUsd)),
      caps,
      now,
    );

    if (!hold.granted) {
      if (hold.cap === 'platform_cap') {
        // Every chapter's calls to this provider stop until the month turns.
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'ai-spend-platform-cap-reached',
          message: `AI platform cap reached for ${call.provider}; refusing calls until the month turns`,
          tags: { provider: call.provider },
        });
      }
      return { granted: false, reason: hold.cap };
    }

    const cap = caps.platformMonthlyMicroUsd;
    if (cap !== null && cap > 0) {
      const month = now.toISOString().slice(0, 7);
      for (const percent of AI_PLATFORM_POOL_ALERTS) {
        const line = (cap * percent) / 100;
        const key = `${call.provider}:${month}:${percent}`;
        if (
          hold.platformSpentAfterMicroUsd >= line &&
          !this.poolLinesReported.has(key)
        ) {
          this.poolLinesReported.add(key);
          reportCaughtFailure(this.logger, {
            // 90% is an error so it reaches Paul's inbox (alert-routing.md:
            // only a new or regressed error-level production issue emails);
            // 50% and 75% are warnings to see in Sentry.
            level: percent >= 90 ? 'error' : 'warning',
            site: `ai-spend-platform-pool-${percent}`,
            message: `AI spend on ${call.provider} has reached ${percent}% of this month's platform cap`,
            tags: { provider: call.provider, percent: String(percent) },
          });
        }
      }
    }

    return { granted: true, reservationId: hold.reservationId };
  }

  async record(usage: AiUsageRecord): Promise<void> {
    const billReservation =
      usage.reservationId !== null &&
      usage.outcome === 'error' &&
      !(usage.errorKind !== null && DOOR_REFUSAL_KINDS.has(usage.errorKind)) &&
      usage.inputTokens === 0 &&
      usage.outputTokens === 0;

    const result = await this.ledger.settle(usage, billReservation, new Date());
    if (result === 'missing') {
      // The provider was called and its hold is gone (settled twice, or its
      // chapter deleted mid-call). The call's result still goes back; the
      // gap is for someone to look at.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-spend-settle-missing',
        message: `AI usage for task ${usage.task} matched no open hold; not recorded`,
        tags: { provider: usage.provider, outcome: usage.outcome },
      });
    }
  }

  /**
   * A chapter's usage in the calendar month (UTC) that holds `at`: what the
   * allowance and overage are read from (billing.md § Implementation
   * invariants). The treasurer's view (#1310) is its first reader.
   */
  async chapterUsage(
    chapterId: string,
    at: Date = new Date(),
  ): Promise<AiChapterUsage> {
    const periodStart = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1),
    );
    const lines = await this.ledger.chapterUsage(
      chapterId,
      periodStart,
      periodEnd,
    );
    return {
      periodStart,
      periodEnd,
      totalCostMicroUsd: lines.reduce((sum, l) => sum + l.costMicroUsd, 0),
      estimatedCostMicroUsd: lines.reduce(
        (sum, l) => sum + l.estimatedCostMicroUsd,
        0,
      ),
      lines,
    };
  }
}
