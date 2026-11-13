import { Module } from '@nestjs/common';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { MEMBER_NUDGE_REPOSITORY } from '#domain/repositories/member-nudge.repository.interface';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { MemberNudgeService } from '../../application/services/member-nudge/member-nudge.service';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { SupabaseMemberNudgeRepository } from '../../infrastructure/supabase/repositories/supabase-member-nudge.repository';
import { SupabaseTaskRepository } from '../../infrastructure/supabase/repositories/supabase-task.repository';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { MemberNudgeController } from '../../interface/controllers/member-nudge.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { AiModule } from '../ai/ai.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Member nudges (#4781): the one card on a member's Activity, written by the
 * AI about one of their own tasks. No background work: the card is worked
 * out when the member opens Activity. The gateway (`AiModule`) carries the
 * consent check, the spend hold and the usage record, as for every model
 * call. Tasks are read through their repository, never changed.
 */
@Module({
  imports: [AiModule, AiConsentModule, RbacModule],
  controllers: [MemberNudgeController],
  providers: [
    MemberNudgeService,
    AiEnabledGuard,
    {
      provide: MEMBER_NUDGE_REPOSITORY,
      useClass: SupabaseMemberNudgeRepository,
    },
    { provide: TASK_REPOSITORY, useClass: SupabaseTaskRepository },
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
  ],
})
export class MemberNudgeModule {}
