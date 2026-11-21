import { Module } from '@nestjs/common';
import { AiReportService } from '../../application/services/ai/ai-report.service';
import { AiReportSweepService } from '../../application/workers/ai-report-sweep.service';
import { AiReportController } from '../../interface/controllers/ai-report.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { SupabaseAiReportRepository } from '../../infrastructure/supabase/repositories/supabase-ai-report.repository';
import { AI_REPORT_REPOSITORY } from '#domain/repositories/ai-report.repository.interface';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { AiSuggestionModule } from '../ai-suggestion/ai-suggestion.module';
import { MeetingDraftModule } from '../meeting/meeting-draft.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Report this (#4315): reports of AI-made text, kept sealed for 30 days, and
 * the sweep that deletes them. A new AI surface that can be reported adds a
 * subject to `AI_REPORT_SUBJECTS` and a branch in `AiReportService`.
 */
@Module({
  imports: [
    RbacModule,
    // A quoted member's No deletes reports quoting them.
    AiConsentModule,
    // Who may see a draft, and what it holds.
    MeetingDraftModule,
    // Who may see a suggestion, and what it holds.
    AiSuggestionModule,
  ],
  controllers: [AiReportController],
  providers: [
    AiReportService,
    AiReportSweepService,
    AiEnabledGuard,
    { provide: AI_REPORT_REPOSITORY, useClass: SupabaseAiReportRepository },
  ],
})
export class AiReportModule {}
