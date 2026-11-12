import { Module } from '@nestjs/common';
import { ChapterGoalService } from '../../application/services/chapter-goal.service';
import { GoalsController } from '../../interface/controllers/goals.controller';
import { SupabaseChapterGoalRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-goal.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { CHAPTER_GOAL_REPOSITORY } from '#domain/repositories/chapter-goal.repository.interface';
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
  ],
  exports: [ChapterGoalService],
})
export class GoalsModule {}
