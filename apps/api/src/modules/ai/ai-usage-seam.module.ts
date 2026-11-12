import { Module } from '@nestjs/common';
import { AI_USAGE_RECORDER } from '#domain/adapters/ai-usage-recorder.interface';
import { DiscardingAiUsageRecorder } from '../../infrastructure/ai/discarding-ai-usage-recorder';

/**
 * Seam 3 of 3: where the AI gateway writes one row per provider call. The
 * ledger slice (#714) changes the binding below, and its imports, and nothing
 * else in the gateway.
 */
@Module({
  providers: [
    { provide: AI_USAGE_RECORDER, useClass: DiscardingAiUsageRecorder },
  ],
  exports: [AI_USAGE_RECORDER],
})
export class AiUsageSeamModule {}
