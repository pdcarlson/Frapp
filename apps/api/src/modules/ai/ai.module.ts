import { Module } from '@nestjs/common';
import { LANGUAGE_MODEL_REGISTRY } from '#domain/adapters/language-model.interface';
import { TRANSCRIBER_REGISTRY } from '#domain/adapters/transcription.interface';
import { AiGatewayService } from '../../application/services/ai/ai-gateway.service';
import { AiTelemetryService } from '../../application/services/ai/ai-telemetry.service';
import { AiTranscriptionService } from '../../application/services/ai/ai-transcription.service';
import { buildLanguageModelRegistry } from '../../infrastructure/ai/language-model-registry';
import { buildTranscriberRegistry } from '../../infrastructure/ai/transcriber-registry';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AiConsentSeamModule } from './ai-consent-seam.module';
import { AiSpendSeamModule } from './ai-spend-seam.module';
import { AiUsageSeamModule } from './ai-usage-seam.module';

/**
 * The AI gateway (ADR-28 decision 1). A feature module imports this and
 * injects `AiGatewayService`, or `AiTranscriptionService` to have a recording
 * transcribed (#712); it never injects an adapter or a seam.
 *
 * The three seams are their own modules so the slices that fill them
 * change a binding, not the gateway. The ledger and caps (#714) fill the
 * spend and usage seams (`AiSpendLedgerModule`); consent (#4308) fills its
 * own.
 */
@Module({
  imports: [
    AnalyticsModule,
    AiConsentSeamModule,
    AiSpendSeamModule,
    AiUsageSeamModule,
  ],
  providers: [
    {
      provide: LANGUAGE_MODEL_REGISTRY,
      useFactory: () => buildLanguageModelRegistry(),
    },
    {
      provide: TRANSCRIBER_REGISTRY,
      useFactory: () => buildTranscriberRegistry(),
    },
    AiTelemetryService,
    AiGatewayService,
    AiTranscriptionService,
  ],
  exports: [AiGatewayService, AiTranscriptionService],
})
export class AiModule {}
