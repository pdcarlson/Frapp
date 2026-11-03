import { Module } from '@nestjs/common';
import { ChatPushWorkerService } from '../../application/workers/chat-push-worker.service';
import { SupabaseChatNotificationPreferenceRepository } from '../../infrastructure/supabase/repositories/supabase-chat-notification-preference.repository';
import { SupabaseChatPushDispatchRepository } from '../../infrastructure/supabase/repositories/supabase-chat-push-dispatch.repository';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { CHAT_NOTIFICATION_PREFERENCE_REPOSITORY } from '#domain/repositories/chat-notification-preference.repository.interface';
import { CHAT_PUSH_DISPATCH_REPOSITORY } from '#domain/repositories/chat-push-dispatch.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { NotificationModule } from '../notification/notification.module';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';
import { ChannelCacheModule } from './channel-cache.module';
import { ChatBlockModule } from '../chat-block/chat-block.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Push worker (ADR-09). Runs in-process on the API; the
 * `OnApplicationBootstrap` lifecycle on `ChatPushWorkerService` opens the
 * Supabase Realtime subscription on `chat_messages`. Scaling watermark for a
 * standalone split is documented in `docs/ops/deployment/render.md`.
 *
 * Imports `NotificationModule` to reuse the preference-aware,
 * quiet-hours-aware Expo fanout; `ChapterModule` to access
 * `MEMBER_REPOSITORY` for chapter membership enumeration.
 */
@Module({
  // `RbacModule` → `RbacService`, used to resolve effective permissions when
  // deciding whether a ROLE_GATED channel's message may be pushed to a member.
  // `ChannelCacheModule` → `ChannelCacheService`, shared with `ChatModule` so a
  // channel write can evict this worker's cached authorization inputs.
  // `ChatBlockModule` → `ChatBlockService`, so a recipient who has blocked the
  // sender is dropped from the push audience (#2257). Imported rather than
  // provided locally so there is one home for the block rule across the four
  // surfaces that owe it.
  // `AuthModule` → `USER_REPOSITORY`, for the sender's display name that every
  // chat push title carries (#2771).
  imports: [
    AuthModule,
    NotificationModule,
    ChapterModule,
    RbacModule,
    ChannelCacheModule,
    ChatBlockModule,
  ],
  providers: [
    ChatPushWorkerService,
    {
      provide: CHAT_NOTIFICATION_PREFERENCE_REPOSITORY,
      useClass: SupabaseChatNotificationPreferenceRepository,
    },
    // The per-message claim that keeps a second instance from re-sending (#2846).
    {
      provide: CHAT_PUSH_DISPATCH_REPOSITORY,
      useClass: SupabaseChatPushDispatchRepository,
    },
    // The routing columns of the channel a message landed in.
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
  ],
})
export class ChatPushWorkerModule {}
