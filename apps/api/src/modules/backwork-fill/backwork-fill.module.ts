import { Module } from '@nestjs/common';
import { DOCUMENT_TEXT_EXTRACTOR } from '#domain/adapters/document-text-extractor.interface';
import { BackworkFillService } from '../../application/services/backwork-fill/backwork-fill.service';
import { DocumentTextExtractor } from '../../infrastructure/extraction/document-text-extractor';
import { BackworkFillController } from '../../interface/controllers/backwork-fill.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { AiModule } from '../ai/ai.module';
import { BackworkModule } from '../backwork/backwork.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * The upload-time AI fill for backwork drafts (#5233). Its own module so
 * the backwork library itself never depends on the AI gateway: one route,
 * no table; the gateway (`AiModule`) carries the consent check, the spend
 * hold and the usage record, as for every model call.
 */
@Module({
  imports: [BackworkModule, AiModule, AiConsentModule, RbacModule],
  controllers: [BackworkFillController],
  providers: [
    BackworkFillService,
    AiEnabledGuard,
    { provide: DOCUMENT_TEXT_EXTRACTOR, useClass: DocumentTextExtractor },
  ],
})
export class BackworkFillModule {}
