import { Module } from '@nestjs/common';
import { AI_CONSENT_CHECK } from '#domain/adapters/ai-consent-check.interface';
import { AiConsentService } from '../../application/services/ai/ai-consent.service';
import { AiConsentModule } from '../ai-consent/ai-consent.module';

/**
 * Seam 1 of 3: what the AI gateway asks before every call. Bound to the
 * consent gates (#4308): the chapter's switch for the call's family is on,
 * and the acting member said yes on the current AI sheet. A member who has
 * not answered counts as No.
 */
@Module({
  imports: [AiConsentModule],
  providers: [{ provide: AI_CONSENT_CHECK, useExisting: AiConsentService }],
  exports: [AI_CONSENT_CHECK],
})
export class AiConsentSeamModule {}
