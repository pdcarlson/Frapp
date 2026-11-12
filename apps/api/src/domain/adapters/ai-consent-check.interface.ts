import type { AiCallDescriptor } from './ai-call-context';

export const AI_CONSENT_CHECK = 'AI_CONSENT_CHECK';

export type AiConsentDecision =
  | { allowed: true }
  | {
      allowed: false;
      /**
       * `chapter_off`: the president has not turned this family on.
       * `member_declined`: the acting member has not said yes on the sheet,
       * which includes never having answered.
       */
      reason: 'chapter_off' | 'member_declined';
    };

/**
 * Seam 1 of 3 in the AI gateway: may this call be made at all
 * (`spec/behavior/ai.md` § Consent, gates 1 and 2).
 *
 * The gateway asks before every call, after the server switch and before any
 * spend is reserved. A denial is returned to the caller as
 * `unavailable: consent`; nothing is sent to a provider.
 *
 * Whose chat messages may be read is not this check. That is decided where
 * the corpus is read, per author.
 *
 * Bound in `modules/ai/ai-consent-seam.module.ts` to `AiConsentService`
 * (#4308): the chapter's switch for the call's family, and the acting
 * member's Yes on the current AI sheet.
 */
export interface IAiConsentCheck {
  check(call: AiCallDescriptor): Promise<AiConsentDecision>;
}
