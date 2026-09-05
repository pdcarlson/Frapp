import { Module } from '@nestjs/common';
import { ChannelAccessService } from '../../application/services/channel-access.service';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Hosts the shared {@link ChannelAccessService} so the chat and poll surfaces
 * authorize through one code path. Imports `ChapterModule` (for
 * `MEMBER_REPOSITORY`) and `RbacModule` (for `RbacService`) and provides its
 * own channel and message repositories.
 *
 * The message repository is here because `assertMessageAccess` moved into this
 * service (#462) — message-level authorization is now shared by the chat hot
 * path and the bookmark surface, so it resolves the message here rather than in
 * each caller.
 */
@Module({
  imports: [ChapterModule, RbacModule],
  providers: [
    ChannelAccessService,
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
  ],
  exports: [ChannelAccessService],
})
export class ChannelAccessModule {}
