import { Module } from '@nestjs/common';
import { MeetingDraftService } from '../../application/services/meeting-draft.service';
import { MeetingDraftRetentionService } from '../../application/workers/meeting-draft-retention.service';
import { MeetingDraftController } from '../../interface/controllers/meeting-draft.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { SupabaseMeetingDraftRepository } from '../../infrastructure/supabase/repositories/supabase-meeting-draft.repository';
import { SupabaseAttendanceRepository } from '../../infrastructure/supabase/repositories/supabase-attendance.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { MEETING_DRAFT_REPOSITORY } from '#domain/repositories/meeting-draft.repository.interface';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { RbacModule } from '../rbac/rbac.module';
import { AiModule } from '../ai/ai.module';
import { AiRunsModule } from '../ai-runs/ai-runs.module';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { MeetingModule } from './meeting.module';

/**
 * Minutes drafted from notes (#4312): the first feature on the AI gateway
 * and the AI run queue. Its own module, so the hand-written minutes
 * (`MeetingModule`) load nothing of AI.
 */
@Module({
  imports: [
    // Who may edit which minutes, and the save the draft goes in through.
    MeetingModule,
    RbacModule,
    AiModule,
    AiRunsModule,
    // The officer is told at once when the chapter or they have not said yes.
    AiConsentModule,
  ],
  controllers: [MeetingDraftController],
  providers: [
    MeetingDraftService,
    MeetingDraftRetentionService,
    AiEnabledGuard,
    {
      provide: MEETING_DRAFT_REPOSITORY,
      useClass: SupabaseMeetingDraftRepository,
    },
    { provide: ATTENDANCE_REPOSITORY, useClass: SupabaseAttendanceRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
  exports: [MeetingDraftService],
})
export class MeetingDraftModule {}
