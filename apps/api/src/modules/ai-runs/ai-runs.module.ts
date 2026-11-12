import { Module } from '@nestjs/common';
import { AiRunService } from '../../application/services/ai-run.service';
import { AiRunRegistry } from '../../application/services/ai-run-registry';
import { AiRunWorkerService } from '../../application/workers/ai-run-worker.service';
import { AiRunController } from '../../interface/controllers/ai-run.controller';
import { SupabaseAiRunRepository } from '../../infrastructure/supabase/repositories/supabase-ai-run.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { AI_RUN_REPOSITORY } from '#domain/repositories/ai-run.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { RbacModule } from '../rbac/rbac.module';

/**
 * The AI run queue (#4310): the table's only reader and writer, the worker
 * that runs it, and the registry features add their run kinds to.
 *
 * A feature that runs background AI work imports this module, registers its
 * handler with `AiRunRegistry` in its own `onModuleInit`, and enqueues
 * through `AiRunService`. The minutes draft (#4312, `MeetingDraftModule`) is
 * the first.
 */
@Module({
  // `RbacService`, for reading a run under a permission its kind names.
  imports: [RbacModule],
  controllers: [AiRunController],
  providers: [
    AiRunService,
    AiRunRegistry,
    AiRunWorkerService,
    { provide: AI_RUN_REPOSITORY, useClass: SupabaseAiRunRepository },
    // The worker checks that the member a run acts for is still in the
    // chapter before it runs.
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
  exports: [AiRunService, AiRunRegistry],
})
export class AiRunsModule {}
