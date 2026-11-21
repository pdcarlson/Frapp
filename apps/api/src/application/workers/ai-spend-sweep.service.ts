import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import {
  AI_USAGE_REPOSITORY,
  type IAiUsageRepository,
} from '#domain/repositories/ai-usage.repository.interface';
import { isAiEnabled } from '#domain/utils/ai-enabled';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/**
 * How long a spend hold may stay unsettled before it expires. The gateway
 * settles every hold before it returns, so a hold this old means the API
 * process died mid-call. Well past any single provider call: the longest
 * output ceiling in the catalog is 16k tokens, minutes of writing at most.
 */
export const AI_SPEND_HOLD_TTL_MS = 60 * 60 * 1000;

/**
 * Expires AI spend holds nobody settled (#714). An expired hold keeps counting
 * toward the caps at its full amount, because the call may have run and been
 * billed; this only marks it, so the ledger tells "still running" from "the
 * process died", and reports it, because each one is a call whose real cost
 * is unknown.
 *
 * Does nothing while `AI_ENABLED` is off: no call is made, so no hold exists.
 */
@Injectable()
export class AiSpendSweepService {
  private readonly logger = new Logger(AiSpendSweepService.name);

  constructor(
    @Inject(AI_USAGE_REPOSITORY) private readonly ledger: IAiUsageRepository,
  ) {}

  @ReportedCron(CronExpression.EVERY_10_MINUTES)
  async handleAiSpendSweep(): Promise<void> {
    await this.sweep(Date.now());
  }

  /** One tick. Returns how many holds expired. */
  async sweep(now: number): Promise<number> {
    if (!isAiEnabled()) return 0;
    const expired = await this.ledger.expireHolds(
      new Date(now - AI_SPEND_HOLD_TTL_MS),
    );
    if (expired > 0) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-spend-hold-expired',
        message: `${expired} AI spend hold(s) expired unsettled; they keep counting at their full hold`,
      });
    }
    return expired;
  }
}
