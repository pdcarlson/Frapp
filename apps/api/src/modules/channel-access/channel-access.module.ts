import { Module } from '@nestjs/common';
import { ChannelAccessService } from '../../application/services/channel-access.service';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Shared channel-authorization. Exports {@link ChannelAccessService} so the
 * chat and poll surfaces enforce the exact same predicate (no drift).
 * `ChapterModule` supplies `MEMBER_REPOSITORY`; `RbacModule` supplies
 * `RbacService` for ROLE_GATED / read-only-post permission checks.
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
