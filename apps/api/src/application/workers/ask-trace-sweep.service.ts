import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { AskTraceService } from '../services/ask/observe/ask-trace.service';
import { ReportedCron } from './reported-cron.decorator';

/**
 * Deletes Ask traces, and the thumbs on them, past their 90 days (#4902,
 * `ai.md` § Stored AI text). Hourly, so "deleted after 90 days" is true
 * within the hour.
 *
 * Runs whether or not `AI_ENABLED` is still on: turning AI off must not
 * leave a member's record behind past its date.
 */
@Injectable()
export class AskTraceSweepService {
  constructor(private readonly traces: AskTraceService) {}

  @ReportedCron(CronExpression.EVERY_HOUR)
  async handleAskTraceSweep(): Promise<void> {
    await this.sweep(new Date());
  }

  /** One tick. Returns how many traces went. */
  sweep(now: Date): Promise<number> {
    return this.traces.sweep(now);
  }
}
