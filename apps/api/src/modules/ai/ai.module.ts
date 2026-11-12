import { Module } from '@nestjs/common';
import { LANGUAGE_MODEL_REGISTRY } from '#domain/adapters/language-model.interface';
import { AiGatewayService } from '../../application/services/ai/ai-gateway.service';
import { AiTelemetryService } from '../../application/services/ai/ai-telemetry.service';
import { buildLanguageModelRegistry } from '../../infrastructure/ai/language-model-registry';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AiConsentSeamModule } from './ai-consent-seam.module';
import { AiSpendSeamModule } from './ai-spend-seam.module';
import { AiUsageSeamModule } from './ai-usage-seam.module';

/**
 * The AI gateway (ADR-28 decision 1). A feature module imports this and
 * injects `AiGatewayService`; it never injects an adapter or a seam.
 *
 * The three seams are their own modules so the slices that fill them
 * (consent #4308, the ledger and caps #714) each change one file.
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
    AiTelemetryService,
    AiGatewayService,
  ],
  exports: [AiGatewayService],
})
export class AiModule {}
