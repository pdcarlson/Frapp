import { Module } from '@nestjs/common';
import { AI_SPEND_RESERVATION } from '#domain/adapters/ai-spend-reservation.interface';
import { AiSpendLedgerService } from '../../application/services/ai/ai-spend-ledger.service';
import { AiSpendLedgerModule } from './ai-spend-ledger.module';

/**
 * Seam 2 of 3: where the AI gateway reserves a call's worst-case cost. Bound
 * to the ledger (#714), which holds it against the chapter's, the member's
 * and the platform's caps.
 */
@Module({
  imports: [AiSpendLedgerModule],
  providers: [
    { provide: AI_SPEND_RESERVATION, useExisting: AiSpendLedgerService },
  ],
  exports: [AI_SPEND_RESERVATION],
})
export class AiSpendSeamModule {}
