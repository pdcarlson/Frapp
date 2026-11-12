import { Module } from '@nestjs/common';
import { AI_SPEND_RESERVATION } from '#domain/adapters/ai-spend-reservation.interface';
import { UnlimitedAiSpendReservation } from '../../infrastructure/ai/unlimited-ai-spend-reservation';

/**
 * Seam 2 of 3: where the AI gateway reserves a call's worst-case cost. The
 * ledger slice (#714) changes the binding below, and its imports, and nothing
 * else in the gateway.
 */
@Module({
  providers: [
    { provide: AI_SPEND_RESERVATION, useClass: UnlimitedAiSpendReservation },
  ],
  exports: [AI_SPEND_RESERVATION],
})
export class AiSpendSeamModule {}
