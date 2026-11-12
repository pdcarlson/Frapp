import { Module } from '@nestjs/common';
import { AiSuggestionService } from '../../application/services/ai-suggestion.service';
import { AiSuggestionConsentListener } from '../../application/services/ai-suggestion-consent.listener';
import { AI_SUGGESTION_KIND_HANDLERS } from '../../application/services/ai-suggestion-kinds';
import { TaskSuggestionKind } from '../../application/services/ai-suggestion-task-kind';
import {
  AI_SUGGESTION_SOURCE_ACCESS,
  ChannelSuggestionSource,
  EventSuggestionSource,
  MeetingSuggestionSource,
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
  ],
  controllers: [AiSuggestionController],
  providers: [
    AiSuggestionService,
    AiSuggestionConsentListener,
    AiSuggestionExpiryService,
    AiEnabledGuard,
    TaskSuggestionKind,
    EventSuggestionSource,
    ChannelSuggestionSource,
    MeetingSuggestionSource,
    MeetingTaskSuggestionsService,
    {
      provide: AI_SUGGESTION_KIND_HANDLERS,
      useFactory: (task: TaskSuggestionKind) => [task],
      inject: [TaskSuggestionKind],
    },
    {
      provide: AI_SUGGESTION_SOURCE_ACCESS,
      useFactory: (
        event: EventSuggestionSource,
        channel: ChannelSuggestionSource,
        meeting: MeetingSuggestionSource,
      ) => [event, channel, meeting],
      inject: [
        EventSuggestionSource,
        ChannelSuggestionSource,
        MeetingSuggestionSource,
      ],
    },
    {
      provide: AI_SUGGESTION_REPOSITORY,
      useClass: SupabaseAiSuggestionRepository,
    },
    // The batch push reads the chapter's modules (a kind's module off means
    // nobody is told).
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
  ],
  // Report this reads one suggestion the reporter can see (#4315).
  exports: [AiSuggestionService],
})
export class AiSuggestionModule {}
