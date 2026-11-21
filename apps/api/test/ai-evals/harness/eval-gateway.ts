/**
 * The real `AiGatewayService`, built for the eval suite and the bake-off.
 *
 * Everything that decides what reaches a model and what comes back is the
 * product's: the catalog lookup, the citation check, the schema parse. Only
 * the three seams are stand-ins (consent allows, spend is unlimited), plus a
 * usage recorder the caller can read, because the bake-off costs each call
 * from the token counts the gateway records.
 *
 * Which model answers is the registry's business. Pass the scripted one for
 * the suite's own run, or a bake-off candidate's (`bake-off/candidates.ts`).
 */
import { AiGatewayService } from '../../../src/application/services/ai/ai-gateway.service';
import type { AiUsageRecord } from '#domain/adapters/ai-usage-recorder.interface';
import type { ILanguageModelRegistry } from '#domain/adapters/language-model.interface';

export interface EvalGateway {
  gateway: AiGatewayService;
  /** Every provider call the gateway recorded, oldest first. Counts only. */
  usage: AiUsageRecord[];
}

export function createEvalGateway(
  registry: ILanguageModelRegistry,
): EvalGateway {
  const usage: AiUsageRecord[] = [];
  const gateway = new AiGatewayService(
    registry,
    { check: () => Promise.resolve({ allowed: true }) },
    { reserve: () => Promise.resolve({ granted: true, reservationId: null }) },
    {
      record: (record) => {
        usage.push(record);
        return Promise.resolve();
      },
    },
    { inSpan: (_call, run) => run(), callFinished: () => Promise.resolve() },
  );
  return { gateway, usage };
}
