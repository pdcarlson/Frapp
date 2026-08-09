import { Module } from '@nestjs/common';
import { ActivationService } from '../../application/services/activation.service';
import { SupabaseActivationMilestoneRepository } from '../../infrastructure/supabase/repositories/supabase-activation-milestone.repository';
import { ACTIVATION_MILESTONE_REPOSITORY } from '../../domain/repositories/activation-milestone.repository.interface';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Activation funnel instrumentation (#267).
 *
 * Imported by the five modules that own a funnel milestone (chapter, invite,
 * chat, chapter-config, billing). It is deliberately a thin leaf — it imports
 * only AnalyticsModule — because every module that emits a milestone must be
 * able to depend on it without creating a cycle.
 */
@Module({
  imports: [AnalyticsModule],
  providers: [
    ActivationService,
    {
      provide: ACTIVATION_MILESTONE_REPOSITORY,
      useClass: SupabaseActivationMilestoneRepository,
    },
  ],
  exports: [ActivationService],
})
export class ActivationModule {}
