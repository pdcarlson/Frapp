import { Injectable, Logger } from '@nestjs/common';
import { ReportedCron } from './reported-cron.decorator';
import { LastYearSuggestionsService } from '../services/last-year-suggestions.service';

/**
 * Once a day, queues the week's "this time last year" run for each chapter
 * that has not had one this week (#3930). The run itself is weekly: the run
 * queue takes a chapter's week once, so the other six ticks only pick up a
 * chapter that turned Ask on since, or whose run failed. Does nothing while
 * `AI_ENABLED` is off; the decision is `LastYearSuggestionsService.sweep`'s.
 */
@Injectable()
export class LastYearSweepService {
  private readonly logger = new Logger(LastYearSweepService.name);
  private running = false;

  constructor(private readonly lastYear: LastYearSuggestionsService) {}

  // 15:00 UTC: mid-morning across the United States, never the small hours.
  @ReportedCron('0 15 * * *')
  async handleLastYearSweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const queued = await this.lastYear.sweep();
      if (queued > 0) {
        this.logger.log(`Queued the last-year check for ${queued} chapters`);
      }
    } finally {
      this.running = false;
    }
  }
}
