import { Module } from '@nestjs/common';
import { AI_CONSENT_CHECK } from '#domain/adapters/ai-consent-check.interface';
import { AllowAllAiConsentCheck } from '../../infrastructure/ai/allow-all-ai-consent-check';

/**
 * Seam 1 of 3: what the AI gateway asks before every call. The consent slice
 * (#4308) changes the binding below, and its imports, and nothing else in the
 * gateway.
 */
@Module({
  providers: [{ provide: AI_CONSENT_CHECK, useClass: AllowAllAiConsentCheck }],
  exports: [AI_CONSENT_CHECK],
})
export class AiConsentSeamModule {}
