import type {
  AiSpendReservationResult,
  IAiSpendReservation,
} from '#domain/adapters/ai-spend-reservation.interface';

/**
 * The placeholder behind the spend seam: grants every reservation and holds
 * nothing. The ledger slice (#714) replaces it in
 * `modules/ai/ai-spend-seam.module.ts` with the reservation against the
 * chapter's and the platform's caps.
 */
export class UnlimitedAiSpendReservation implements IAiSpendReservation {
  reserve(): Promise<AiSpendReservationResult> {
    return Promise.resolve({ granted: true, reservationId: null });
  }
}
