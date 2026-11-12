import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { AiReportService } from '../services/ai/ai-report.service';
import { ReportedCron } from './reported-cron.decorator';

/**
 * Deletes reports past their 30 days (#4315, `ai.md` § Stored AI text).
 * Hourly, so "deleted after 30 days" is true within the hour.
 *
 * Runs whether or not `AI_ENABLED` is still on: turning AI off must not
 * leave stored text behind past its date.
 */
@Injectable()
export class AiReportSweepService {
  constructor(private readonly reports: AiReportService) {}

  @ReportedCron(CronExpression.EVERY_HOUR)
  async handleAiReportSweep(): Promise<void> {
    await this.sweep(new Date());
  }

  /** One tick. Returns how many reports went. */
  sweep(now: Date): Promise<number> {
    return this.reports.sweep(now);
  }
}
