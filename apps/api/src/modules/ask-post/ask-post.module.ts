import { Module } from '@nestjs/common';
import { AskPostService } from '../../application/services/ask-post/ask-post.service';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { AskPostController } from '../../interface/controllers/ask-post.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { CHAT_MESSAGE_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ChannelAccessModule } from '../channel-access/channel-access.module';
import { EventModule } from '../event/event.module';
import { MeetingModule } from '../meeting/meeting.module';

/**
 * Posting an Ask Frapp answer to a channel (#4713).
 *
 * Its own module, apart from `AskModule`, on purpose: Ask and the acting
 * agent hold no way to write a message (`ask-posts-nothing.spec.ts`), and
 * this is the one place an answer becomes one. It imports no AI module and
 * calls no model: what it posts was already written and sealed by Ask.
 */
@Module({
  imports: [ChannelAccessModule, MeetingModule, EventModule, AnalyticsModule],
  controllers: [AskPostController],
  providers: [
    AskPostService,
    AiEnabledGuard,
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
  ],
})
export class AskPostModule {}
