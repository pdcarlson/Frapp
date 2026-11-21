import type { AiCallDescriptor } from './ai-call-context';
import type { LanguageModelErrorKind } from './language-model.interface';

export const AI_USAGE_RECORDER = 'AI_USAGE_RECORDER';

/**
 * How one provider call ended.
 *
 * - `completed`: the model answered.
 * - `refused`: the provider declined under its own policy.
 * - `invalid_output`: it answered, and the answer did not match the schema.
 * - `error`: the call failed. Tokens are zero unless the provider reported
 *   some before failing.
 */
export type AiCallOutcome =
  'completed' | 'refused' | 'invalid_output' | 'error';

/**
 * One provider call, as the ledger keeps it. There is no text field and
 * there must never be one (`spec/behavior/ai.md` § Stored AI text): counts,
 * the model, the prompt version and the cost.
 */
export interface AiUsageRecord extends AiCallDescriptor {
  /** From the spend reservation this call was made under, if it held one. */
  reservationId: string | null;
  outcome: AiCallOutcome;
  /** Set when `outcome` is `error`. */
  errorKind: LanguageModelErrorKind | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /**
   * Seconds of audio a transcription call was billed for; absent on every
   * other call (`billing.md`: "transcription seconds").
   */
  audioSeconds?: number;
  /** At the catalog's prices, in millionths of a US dollar. */
  costMicroUsd: number;
  latencyMs: number;
}

/**
 * Seam 3 of 3 in the AI gateway: write the usage row (ADR-28 decision 1,
 * #714).
 *
 * The gateway awaits this before it returns or rethrows, once per provider
 * call that was attempted. A call stopped earlier (server switch off, no
 * credential, consent, a cap) reached no provider and is not recorded. If
 * `record` throws, the gateway's call fails with it: a result is not handed
 * back with its cost unrecorded.
 *
 * Bound in `modules/ai/ai-usage-seam.module.ts` to the ledger's
 * `AiSpendLedgerService` (#714), which settles the call's hold in
 * `ai_usage_events`.
 */
export interface IAiUsageRecorder {
  record(usage: AiUsageRecord): Promise<void>;
}
