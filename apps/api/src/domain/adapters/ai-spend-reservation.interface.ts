import type { AiCallDescriptor } from './ai-call-context';

export const AI_SPEND_RESERVATION = 'AI_SPEND_RESERVATION';

/** The most this call can cost, worked out before it is made. */
export interface AiSpendEstimate {
  /** Input tokens, estimated from the request's size. */
  inputTokens: number;
  /** The call's output ceiling, from the catalog. */
  maxOutputTokens: number;
  /** Both, at the catalog's prices, in millionths of a US dollar. */
  maxCostMicroUsd: number;
}

export type AiSpendReservationResult =
  | {
      granted: true;
      /**
       * Handed back to the usage recorder with the call's real cost, which is
       * what settles the reservation. `null` when nothing was held.
       */
      reservationId: string | null;
    }
  | {
      granted: false;
      /** Which cap the estimate would cross. */
      reason: 'chapter_cap' | 'platform_cap';
    };

/**
 * Seam 2 of 3 in the AI gateway: hold the call's worst-case cost against the
 * caps before it is made (ADR-28 decision 1, #714).
 *
 * The gateway reserves after consent and before the provider call. A refusal
 * is returned to the caller as `unavailable: spend_cap`; nothing is sent to a
 * provider. Every granted reservation is followed by exactly one
 * `IAiUsageRecorder.record` carrying its id, whether the call completed, was
 * refused or failed, so an implementation settles or releases there.
 *
 * Bound in `modules/ai/ai-spend-seam.module.ts`. The ledger slice (#714)
 * replaces the binding there and edits nothing in the gateway.
 */
export interface IAiSpendReservation {
  reserve(
    call: AiCallDescriptor,
    estimate: AiSpendEstimate,
  ): Promise<AiSpendReservationResult>;
}
