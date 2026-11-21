import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  AI_SUGGESTION_REPOSITORY,
  type IAiSuggestionRepository,
} from '#domain/repositories/ai-suggestion.repository.interface';
import { AiConsentService } from './ai/ai-consent.service';

/**
 * When a member says No on the AI sheet, their words leave every suggestion
 * that quotes them (#4308, `spec/behavior/ai.md` § Chat as a source). The
 * suggestion stays, showing its source without the quote. Deleting an
 * account does the same in `anonymize_user`.
 *
 * The consent service awaits this after saving the No, so a failure fails the
 * answer and the member's retry runs it again; it is safe to run twice.
 */
@Injectable()
export class AiSuggestionConsentListener implements OnModuleInit {
  constructor(
    private readonly consent: AiConsentService,
    @Inject(AI_SUGGESTION_REPOSITORY)
    private readonly suggestions: IAiSuggestionRepository,
  ) {}

  onModuleInit(): void {
    this.consent.onConsentWithdrawn(async (userId) => {
      await this.suggestions.dropQuotesBy(userId);
    });
  }
}
