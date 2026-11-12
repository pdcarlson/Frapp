import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import { AiSuggestionService } from '../services/ai-suggestion.service';

/**
 * Puts back accepts the API never finished, then expires AI suggestions
 * nobody decided (#4309, spec/behavior/ai.md
 * § Suggestions), hourly, in every chapter. Expiring empties a suggestion's
 * text in the same write, so an expired row keeps no AI output. Runs whether
 * or not `AI_ENABLED` is on: rows written while it was on still expire after
 * it is turned off. A failure is reported by `@ReportedCron` and the next tick
 * tries again; the update is idempotent.
 */
@Injectable()
export class AiSuggestionExpiryService {
  private readonly logger = new Logger(AiSuggestionExpiryService.name);
  private running = false;

  constructor(private readonly suggestions: AiSuggestionService) {}

  @ReportedCron(CronExpression.EVERY_HOUR)
  async handleAiSuggestionExpirySweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // First, so an accept that died past its expiry is expired below.
      const released = await this.suggestions.releaseStaleAccepts();
      if (released > 0) {
        this.logger.warn(`Put back ${released} AI suggestions left mid-accept`);
      }
      const expired = await this.suggestions.expireDue();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} AI suggestions`);
      }
    } finally {
      this.running = false;
    }
  }
}
