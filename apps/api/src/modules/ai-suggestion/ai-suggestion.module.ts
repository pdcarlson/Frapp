import { Module } from '@nestjs/common';
import { AiSuggestionService } from '../../application/services/ai-suggestion.service';
import { AiSuggestionConsentListener } from '../../application/services/ai-suggestion-consent.listener';
import { AI_SUGGESTION_KIND_HANDLERS } from '../../application/services/ai-suggestion-kinds';
import { TaskSuggestionKind } from '../../application/services/ai-suggestion-task-kind';
import { EventSuggestionKind } from '../../application/services/ai-suggestion-event-kind';
import {
  AI_SUGGESTION_SOURCE_ACCESS,
  ChannelSuggestionSource,
  EventSuggestionSource,
  MeetingSuggestionSource,
  TaskSuggestionSource,
} from '../../application/services/ai-suggestion-sources';
import { AiSuggestionExpiryService } from '../../application/workers/ai-suggestion-expiry.service';
import { AiSuggestionController } from '../../interface/controllers/ai-suggestion.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { SupabaseAiSuggestionRepository } from '../../infrastructure/supabase/repositories/supabase-ai-suggestion.repository';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { AI_SUGGESTION_REPOSITORY } from '#domain/repositories/ai-suggestion.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { RbacModule } from '../rbac/rbac.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { NotificationModule } from '../notification/notification.module';
import { TaskModule } from '../task/task.module';
import { EventModule } from '../event/event.module';
import { ChannelAccessModule } from '../channel-access/channel-access.module';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { MeetingModule } from '../meeting/meeting.module';
import { MeetingTaskSuggestionsService } from '../../application/services/meeting-task-suggestions.service';
import { LastYearSuggestionsService } from '../../application/services/last-year-suggestions.service';
import { LastYearSweepService } from '../../application/workers/last-year-sweep.service';
import { AiRunsModule } from '../ai-runs/ai-runs.module';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';

/**
 * AI suggestions (#4309). A new kind is a handler added to the kinds list; a
 * new source is an access checker added to the sources list (a source type
 * with none is shown to nobody).
 */
@Module({
  imports: [
    RbacModule,
    AnalyticsModule,
    NotificationModule,
    TaskModule,
    EventModule,
    ChannelAccessModule,
    // The read rule for minutes, and the moment minutes post (#4313).
    MeetingModule,
    // A No on the AI sheet takes the member's words out of suggestions.
    AiConsentModule,
    // The weekly "this time last year" check is a run of the queue (#3930).
    AiRunsModule,
  ],
  controllers: [AiSuggestionController],
  providers: [
    AiSuggestionService,
    AiSuggestionConsentListener,
    AiSuggestionExpiryService,
    AiEnabledGuard,
    TaskSuggestionKind,
    EventSuggestionKind,
    EventSuggestionSource,
    ChannelSuggestionSource,
    MeetingSuggestionSource,
    TaskSuggestionSource,
    MeetingTaskSuggestionsService,
    LastYearSuggestionsService,
    LastYearSweepService,
    {
      provide: AI_SUGGESTION_KIND_HANDLERS,
      useFactory: (task: TaskSuggestionKind, event: EventSuggestionKind) => [
        task,
        event,
      ],
      inject: [TaskSuggestionKind, EventSuggestionKind],
    },
    {
      provide: AI_SUGGESTION_SOURCE_ACCESS,
      useFactory: (
        event: EventSuggestionSource,
        channel: ChannelSuggestionSource,
        meeting: MeetingSuggestionSource,
        task: TaskSuggestionSource,
      ) => [event, channel, meeting, task],
      inject: [
        EventSuggestionSource,
        ChannelSuggestionSource,
        MeetingSuggestionSource,
        TaskSuggestionSource,
      ],
    },
    {
      provide: AI_SUGGESTION_REPOSITORY,
      useClass: SupabaseAiSuggestionRepository,
    },
    // The batch push reads the chapter's modules (a kind's module off means
    // nobody is told).
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
    // The last-year check acts for the chapter's president.
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: ROLE_REPOSITORY, useClass: SupabaseRoleRepository },
  ],
  // Report this reads one suggestion the reporter can see (#4315).
  exports: [AiSuggestionService],
})
export class AiSuggestionModule {}
