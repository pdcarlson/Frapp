import type {
  AiConsentDecision,
  IAiConsentCheck,
} from '#domain/adapters/ai-consent-check.interface';

/**
 * The placeholder behind the consent seam: allows every call.
 *
 * It exists so the gateway can be built and tested before the consent tables
 * are. It must not be the binding when member data first reaches a model:
 * the consent slice (#4308) replaces it in
 * `modules/ai/ai-consent-seam.module.ts`. Until then the server switch
 * (`AI_ENABLED`, off by default) is what keeps any call from being made.
 */
export class AllowAllAiConsentCheck implements IAiConsentCheck {
  check(): Promise<AiConsentDecision> {
    return Promise.resolve({ allowed: true });
  }
}
