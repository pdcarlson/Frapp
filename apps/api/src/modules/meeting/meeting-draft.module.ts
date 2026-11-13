import { Module } from '@nestjs/common';
import { MeetingDraftService } from '../../application/services/meeting-draft.service';
import { MeetingDraftRetentionService } from '../../application/workers/meeting-draft-retention.service';
import { MeetingDraftController } from '../../interface/controllers/meeting-draft.controller';
import { MeetingNotesController } from '../../interface/controllers/meeting-notes.controller';
import { MeetingNotesService } from '../../application/services/meeting-notes.service';
import { SupabaseMeetingNotesRepository } from '../../infrastructure/supabase/repositories/supabase-meeting-notes.repository';
import { SupabaseMeetingRecordingRepository } from '../../infrastructure/supabase/repositories/supabase-meeting-recording.repository';
import { MEETING_NOTES_REPOSITORY } from '#domain/repositories/meeting-notes.repository.interface';
import { MEETING_RECORDING_REPOSITORY } from '#domain/repositories/meeting-recording.repository.interface';
import { NotificationModule } from '../notification/notification.module';
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
 * and the AI run queue. Since #4935 it also holds each note-taker's notes
 * (`MeetingNotesService`), which are what a draft reads. Its own module, so the hand-written minutes
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
    // A member added as a note-taker is told (#4935).
    NotificationModule,
  ],
  controllers: [MeetingDraftController, MeetingNotesController],
  providers: [
    MeetingDraftService,
    MeetingNotesService,
    MeetingDraftRetentionService,
    AiEnabledGuard,
    {
      provide: MEETING_DRAFT_REPOSITORY,
      useClass: SupabaseMeetingDraftRepository,
    },
    {
      provide: MEETING_NOTES_REPOSITORY,
      useClass: SupabaseMeetingNotesRepository,
    },
    // The draft reads the recording's transcript as a source of its own.
    {
      provide: MEETING_RECORDING_REPOSITORY,
      useClass: SupabaseMeetingRecordingRepository,
    },
    { provide: ATTENDANCE_REPOSITORY, useClass: SupabaseAttendanceRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
  exports: [MeetingDraftService],
})
export class MeetingDraftModule {}
