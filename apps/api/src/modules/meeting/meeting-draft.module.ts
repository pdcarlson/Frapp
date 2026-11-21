import { Module } from '@nestjs/common';
import { MeetingDraftService } from '../../application/services/meeting-draft.service';
import { MeetingDraftRetentionService } from '../../application/workers/meeting-draft-retention.service';
import { MeetingDraftController } from '../../interface/controllers/meeting-draft.controller';
import { MeetingNotesController } from '../../interface/controllers/meeting-notes.controller';
import { MeetingNotesService } from '../../application/services/meeting-notes.service';
import { MeetingDraftContextService } from '../../application/services/meeting-draft-context.service';
import { AgendaSuggestionService } from '../../application/services/agenda-suggestion.service';
import { AgendaSuggestionController } from '../../interface/controllers/agenda-suggestion.controller';
import { SupabaseEventAgendaSuggestionRepository } from '../../infrastructure/supabase/repositories/supabase-event-agenda-suggestion.repository';
import { SupabaseRoleTierRepository } from '../../infrastructure/supabase/repositories/supabase-role-tier.repository';
import { SupabaseEventTypeRepository } from '../../infrastructure/supabase/repositories/supabase-event-type.repository';
import { EVENT_AGENDA_SUGGESTION_REPOSITORY } from '#domain/repositories/event-agenda-suggestion.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import { EVENT_TYPE_REPOSITORY } from '#domain/repositories/event-type.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
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
import { EventModule } from '../event/event.module';
import { MEETING_NEXT_AGENDA_ITEM_REPOSITORY } from '#domain/repositories/meeting-next-agenda-item.repository.interface';
import { SupabaseMeetingNextAgendaItemRepository } from '../../infrastructure/supabase/repositories/supabase-meeting-next-agenda-item.repository';

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
    // Tonight's agenda and which earlier minutes share its audience (#5477).
    EventModule,
    RbacModule,
    AiModule,
    AiRunsModule,
    // The officer is told at once when the chapter or they have not said yes.
    AiConsentModule,
    // A member added as a note-taker is told (#4935).
    NotificationModule,
  ],
  controllers: [
    MeetingDraftController,
    MeetingNotesController,
    // Suggested agenda items (#5534): they read earlier minutes as the
    // officer, as the draft's background does, on the same AI seams.
    AgendaSuggestionController,
  ],
  providers: [
    MeetingDraftService,
    MeetingNotesService,
    MeetingDraftContextService,
    AgendaSuggestionService,
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
    {
      provide: EVENT_AGENDA_SUGGESTION_REPOSITORY,
      useClass: SupabaseEventAgendaSuggestionRepository,
    },
    // What earlier minutes sent to the next meeting's agenda (#5790).
    {
      provide: MEETING_NEXT_AGENDA_ITEM_REPOSITORY,
      useClass: SupabaseMeetingNextAgendaItemRepository,
    },
    { provide: ROLE_TIER_REPOSITORY, useClass: SupabaseRoleTierRepository },
    { provide: EVENT_TYPE_REPOSITORY, useClass: SupabaseEventTypeRepository },
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
  ],
  exports: [MeetingDraftService],
})
export class MeetingDraftModule {}
