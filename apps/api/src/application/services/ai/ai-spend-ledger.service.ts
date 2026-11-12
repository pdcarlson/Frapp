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
 * How full a provider's monthly pool is when Paul hears about it, in percent.
 * Each is reported once, by the hold that crosses it (the holds on a provider
 * are serialized, so exactly one does), at warning level until the last.
 */
export const AI_PLATFORM_POOL_ALERTS = [50, 75, 90, 100] as const;

/**
 * Error kinds after which the provider may have done, and billed, work it
 * never reported: the member stopped reading a stream (the gateway records it
 * as `aborted` with no counts), or the call ran out of time while the
 * provider was still answering. Every other failure is a refusal at the door
 * (`rate_limited`, `auth`, `invalid_request`...), which costs nothing.
 */
const UNREPORTED_WORK_KINDS: ReadonlySet<string> = new Set([
  'aborted',
  'timeout',
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
 *   and cost, before the gateway returns. A call whose provider never said
 *   what it used (an abandoned stream, a timeout) is charged its whole hold,
 *   marked as an estimate (`spec/behavior/billing.md` § Abandoned and
 *   unanswered calls).
 *
 * Nothing here sees a prompt or an answer: the gateway hands the seams who,
 * which task and how much, and the ledger has no text column.
 */
@Injectable()
export class AiSpendLedgerService
  implements IAiSpendReservation, IAiUsageRecorder
{
  private readonly logger = new Logger(AiSpendLedgerService.name);

  constructor(
    @Inject(AI_USAGE_REPOSITORY) private readonly ledger: IAiUsageRepository,
  ) {}

  async reserve(
    call: AiCallDescriptor,
    estimate: AiSpendEstimate,
  ): Promise<AiSpendReservationResult> {
    const caps = aiSpendCaps(call.provider);
    const hold = await this.ledger.reserve(
      call,
      Math.max(0, Math.ceil(estimate.maxCostMicroUsd)),
      caps,
      new Date(),
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
      for (const percent of AI_PLATFORM_POOL_ALERTS) {
        const line = (cap * percent) / 100;
        if (
          hold.platformSpentBeforeMicroUsd < line &&
          hold.platformSpentAfterMicroUsd >= line
        ) {
          reportCaughtFailure(this.logger, {
            level: percent === 100 ? 'error' : 'warning',
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
      usage.errorKind !== null &&
      UNREPORTED_WORK_KINDS.has(usage.errorKind) &&
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
