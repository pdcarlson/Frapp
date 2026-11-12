import { Module } from '@nestjs/common';
import { AiSuggestionService } from '../../application/services/ai-suggestion.service';
import { AI_SUGGESTION_KIND_HANDLERS } from '../../application/services/ai-suggestion-kinds';
import { TaskSuggestionKind } from '../../application/services/ai-suggestion-task-kind';
import {
  AI_SUGGESTION_SOURCE_ACCESS,
  ChannelSuggestionSource,
  EventSuggestionSource,
} from '../../application/services/ai-suggestion-sources';
import { AiSuggestionExpiryService } from '../../application/workers/ai-suggestion-expiry.service';
import { AiSuggestionController } from '../../interface/controllers/ai-suggestion.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { SupabaseAiSuggestionRepository } from '../../infrastructure/supabase/repositories/supabase-ai-suggestion.repository';
import { AI_SUGGESTION_REPOSITORY } from '#domain/repositories/ai-suggestion.repository.interface';
import { RbacModule } from '../rbac/rbac.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { NotificationModule } from '../notification/notification.module';
import { TaskModule } from '../task/task.module';
import { EventModule } from '../event/event.module';
import { ChannelAccessModule } from '../channel-access/channel-access.module';

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
  ],
  controllers: [AiSuggestionController],
  providers: [
    AiSuggestionService,
    AiSuggestionExpiryService,
    AiEnabledGuard,
    TaskSuggestionKind,
    EventSuggestionSource,
    ChannelSuggestionSource,
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
      ) => [event, channel],
      inject: [EventSuggestionSource, ChannelSuggestionSource],
    },
    {
      provide: AI_SUGGESTION_REPOSITORY,
      useClass: SupabaseAiSuggestionRepository,
    },
  ],
})
export class AiSuggestionModule {}
