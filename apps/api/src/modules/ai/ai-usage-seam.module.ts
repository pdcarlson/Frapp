import { Module } from '@nestjs/common';
import { AI_USAGE_RECORDER } from '#domain/adapters/ai-usage-recorder.interface';
import { AiSpendLedgerService } from '../../application/services/ai/ai-spend-ledger.service';
import { AiSpendLedgerModule } from './ai-spend-ledger.module';

/**
 * Seam 3 of 3: where the AI gateway writes one row per provider call. Bound
 * to the ledger (#714), which settles the call's hold with what it really
 * used.
 */
@Module({
  imports: [AiSpendLedgerModule],
  providers: [
    { provide: AI_USAGE_RECORDER, useExisting: AiSpendLedgerService },
  ],
  exports: [AI_USAGE_RECORDER],
})
export class AiUsageSeamModule {}
