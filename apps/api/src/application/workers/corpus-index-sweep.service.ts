import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ChatCorpusConsentService } from '../services/corpus/chat-corpus-consent.service';
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
  private reconciling = false;

  constructor(
    private readonly ingest: CorpusIngestService,
    private readonly chatConsent: ChatCorpusConsentService,
  ) {}

  /**
   * Hourly: rebuilds chat windows whose authors' answers changed without a
   * No being given (a new sheet, a deleted account, a member who said yes),
   * well inside the day the spec allows (#4314). It runs whether or not
   * `AI_ENABLED` is on, because it only ever removes words from, or
   * re-queues, what is already stored.
   */
  @ReportedCron(CronExpression.EVERY_HOUR)
  async handleChatCorpusReconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const requeued = await this.chatConsent.reconcile();
      if (requeued > 0)
        this.logger.log(
          `Re-queued ${requeued} chat windows after consent changes`,
        );
    } finally {
      this.reconciling = false;
    }
  }

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
