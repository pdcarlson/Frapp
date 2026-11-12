import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { CorpusIngestService } from '../services/corpus/corpus-ingest.service';
import { ReportedCron } from './reported-cron.decorator';

/**
 * Once a minute, queues an indexing run for each AI corpus source that
 * needs one (#720). Does nothing while `AI_ENABLED` is off; the decision is
 * `CorpusIngestService.sweep`'s. A failure is reported by `@ReportedCron`
 * and the next minute tries again: a claimed source that was not queued
 * comes back when its wait runs out.
 */
@Injectable()
export class CorpusIndexSweepService {
  private readonly logger = new Logger(CorpusIndexSweepService.name);
  private running = false;

  constructor(private readonly ingest: CorpusIngestService) {}

  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleCorpusIndexSweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const queued = await this.ingest.sweep();
      if (queued > 0)
        this.logger.log(`Queued ${queued} corpus sources to index`);
    } finally {
      this.running = false;
    }
  }
}
