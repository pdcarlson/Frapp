import type { IAiUsageRecorder } from '#domain/adapters/ai-usage-recorder.interface';

/**
 * The placeholder behind the usage seam: records nothing. The ledger slice
 * (#714) replaces it in `modules/ai/ai-usage-seam.module.ts` with the write
 * to the usage table.
 */
export class DiscardingAiUsageRecorder implements IAiUsageRecorder {
  record(): Promise<void> {
    return Promise.resolve();
  }
}
