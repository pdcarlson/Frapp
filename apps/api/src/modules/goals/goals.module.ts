import { Module } from '@nestjs/common';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import { ChapterGoalService } from '../../application/services/chapter-goal.service';
import { GoalsController } from '../../interface/controllers/goals.controller';
import { SupabaseChapterAuditLogRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-audit-log.repository';
import { SupabaseChapterGoalRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-goal.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { CHAPTER_AUDIT_LOG_REPOSITORY } from '#domain/repositories/chapter-audit-log.repository.interface';
import { CHAPTER_GOAL_REPOSITORY } from '#domain/repositories/chapter-goal.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';

/**
 * Chapter goals (#1062): officers set them in Chapter settings, and Activity's
 * standing reads each member's through {@link ChapterGoalService}.
 */
@Module({
  controllers: [GoalsController],
  providers: [
    ChapterGoalService,
    {
      provide: CHAPTER_GOAL_REPOSITORY,
      useClass: SupabaseChapterGoalRepository,
    },
    // The chapter's roles: which ids a goal may name, and their order.
    { provide: ROLE_REPOSITORY, useClass: SupabaseRoleRepository },
    // The caller's roles, for `GET /v1/goals/mine`.
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    // A save is audited and mirrored to #chapter-audit.
    ChapterAuditLogService,
    {
      provide: CHAPTER_AUDIT_LOG_REPOSITORY,
      useClass: SupabaseChapterAuditLogRepository,
    },
  ],
  exports: [ChapterGoalService],
})
export class GoalsModule {}
