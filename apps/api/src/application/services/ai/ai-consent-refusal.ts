import { ForbiddenException } from '@nestjs/common';
import type { AiConsentDecision } from '#domain/adapters/ai-consent-check.interface';

type ConsentDenial = Extract<AiConsentDecision, { allowed: false }>['reason'];

/**
 * The HTTP answer for a gateway call refused by consent
 * (`{ status: 'unavailable', reason: 'consent', detail }`), so every AI route
 * says it the same way and a client knows what to show (#4308):
 *
 * - `ai.consent.required`: the caller has not said yes on the current AI
 *   sheet, or said No. Show the sheet (`GET /v1/ai/consent`).
 * - `ai.chapter_off`: the president has not turned this feature on. Hide the
 *   entry point (`GET /v1/ai/settings`).
 *
 * A background run that meets the same refusal fails, and is retried only
 * when the member asks again.
 */
export function aiConsentRefusal(detail: ConsentDenial): ForbiddenException {
  if (detail === 'chapter_off') {
    return new ForbiddenException({
      code: 'ai.chapter_off',
      message: 'This AI feature is turned off for the chapter.',
    });
  }
  return new ForbiddenException({
    code: 'ai.consent.required',
    message: 'Turn on Frapp AI before using AI features.',
  });
}
