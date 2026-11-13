import { Module } from '@nestjs/common';
import { CHAT_CATCH_UP_REPOSITORY } from '#domain/repositories/chat-catch-up.repository.interface';
import { CHAT_MEMBER_BLOCK_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { ChatCatchUpService } from '../../application/services/chat-catch-up/chat-catch-up.service';
import { SupabaseChatCatchUpRepository } from '../../infrastructure/supabase/repositories/supabase-chat-catch-up.repository';
import { SupabaseChatMemberBlockRepository } from '../../infrastructure/supabase/repositories/supabase-chat-member-block.repository';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { ChatCatchUpController } from '../../interface/controllers/chat-catch-up.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { AiModule } from '../ai/ai.module';
import { ChannelAccessModule } from '../channel-access/channel-access.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Catch me up (#3946): a channel's new messages, or one thread, summarized
 * for the member who asks. One route, no table, no background work: the
 * gateway (`AiModule`) carries the consent check, the spend hold and the
 * usage record, as for every model call.
 */
@Module({
  imports: [AiModule, AiConsentModule, ChannelAccessModule, RbacModule],
  controllers: [ChatCatchUpController],
  providers: [
    ChatCatchUpService,
    AiEnabledGuard,
    {
      provide: CHAT_CATCH_UP_REPOSITORY,
      useClass: SupabaseChatCatchUpRepository,
    },
    {
      provide: CHAT_MEMBER_BLOCK_REPOSITORY,
      useClass: SupabaseChatMemberBlockRepository,
    },
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
  ],
  // Ask's conversation tools read a channel through `readStretch` (#4900).
  exports: [ChatCatchUpService],
})
export class ChatCatchUpModule {}
