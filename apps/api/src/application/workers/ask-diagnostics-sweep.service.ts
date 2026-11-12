import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { AskDiagnosticsService } from '../services/ask/ask-diagnostics.service';
import { ReportedCron } from './reported-cron.decorator';

/**
 * Ends the Ask diagnostics window at its fixed end date (#4315, `ai.md` §
 * Stored AI text): deletes the window, and with it everything it kept. A
 * window past its end already keeps nothing more (the service checks the
 * date on every write), so this is what makes "deleted after 14 days" true
 * within ten minutes of the date.
 *
 * Runs whether or not `AI_ENABLED` is still on: turning AI off must not
 * leave stored text behind past its date.
 */
@Injectable()
export class AskDiagnosticsSweepService {
  constructor(private readonly diagnostics: AskDiagnosticsService) {}

  @ReportedCron(CronExpression.EVERY_10_MINUTES)
  async handleAskDiagnosticsSweep(): Promise<void> {
    await this.sweep(new Date());
  }

  /** One tick. Returns how many windows ended. */
  sweep(now: Date): Promise<number> {
    return this.diagnostics.sweep(now);
  }
}
