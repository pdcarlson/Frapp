import { Module } from '@nestjs/common';
import { ChannelAccessService } from '../../application/services/channel-access.service';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Hosts the shared {@link ChannelAccessService} so the chat and poll surfaces
 * authorize through one code path. Imports `ChapterModule` (for
 * `MEMBER_REPOSITORY`) and `RbacModule` (for `RbacService`) and provides its
 * own channel repository.
 */
@Module({
  imports: [ChapterModule, RbacModule],
  providers: [
    ChannelAccessService,
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
  ],
  exports: [ChannelAccessService],
})
export class ChannelAccessModule {}
