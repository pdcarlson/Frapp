import { Module } from '@nestjs/common';
import { AI_USAGE_REPOSITORY } from '#domain/repositories/ai-usage.repository.interface';
import { AiSpendLedgerService } from '../../application/services/ai/ai-spend-ledger.service';
import { AiSpendSweepService } from '../../application/workers/ai-spend-sweep.service';
import { SupabaseAiUsageRepository } from '../../infrastructure/supabase/repositories/supabase-ai-usage.repository';

/**
 * The AI spend ledger and caps (#714): `ai_usage_events`, the service behind
 * the gateway's spend and usage seams, and the sweep that expires holds a
 * dead process left.
 *
 * Both seam modules import this one and bind their token to the same
 * `AiSpendLedgerService`, so a hold and its settlement go through one
 * instance. A later reader of usage (the treasurer's view, #1310) imports it
 * for `chapterUsage`.
 */
@Module({
  providers: [
    { provide: AI_USAGE_REPOSITORY, useClass: SupabaseAiUsageRepository },
    AiSpendLedgerService,
    AiSpendSweepService,
  ],
  exports: [AiSpendLedgerService],
})
export class AiSpendLedgerModule {}
