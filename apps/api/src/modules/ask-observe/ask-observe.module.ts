import { Module } from '@nestjs/common';
import { AskFeedbackService } from '../../application/services/ask/observe/ask-feedback.service';
import { AskTraceService } from '../../application/services/ask/observe/ask-trace.service';
import { AskTraceSweepService } from '../../application/workers/ask-trace-sweep.service';
import { AskFeedbackController } from '../../interface/controllers/ask-feedback.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { SupabaseAskTraceRepository } from '../../infrastructure/supabase/repositories/supabase-ask-trace.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { ASK_TRACE_REPOSITORY } from '#domain/repositories/ask-trace.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * What Frapp learns from real use of Ask (#4902): a trace of every turn with
 * no text in it, the asker's thumbs on the answer, and the sweep that
 * deletes both after 90 days.
 *
 * `AskTraceService` is exported for the Ask loop (`AskModule`), which calls
 * `record` once when a turn ends. A thumbs is taken only on an ask that has
 * a trace, which is how the routes know whose answer it was.
 */
@Module({
  imports: [
    RbacModule,
    // A member's No on the AI sheet deletes their traces.
    AiConsentModule,
    AnalyticsModule,
  ],
  controllers: [AskFeedbackController],
  providers: [
    AskTraceService,
    AskFeedbackService,
    AskTraceSweepService,
    AiEnabledGuard,
    { provide: ASK_TRACE_REPOSITORY, useClass: SupabaseAskTraceRepository },
    // The trace names the asker's membership row, so it goes when they leave.
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
  exports: [AskTraceService],
})
export class AskObserveModule {}
