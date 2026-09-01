import { Module } from '@nestjs/common';
import { ChatService } from '../../application/services/chat.service';
import { ChatController } from '../../interface/controllers/chat.controller';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatCategoryRepository } from '../../infrastructure/supabase/repositories/supabase-chat-category.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseChatMessageActionRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-action.repository';
import { SupabaseChatMessageAttachmentRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-attachment.repository';
import { SupabaseMessageReactionRepository } from '../../infrastructure/supabase/repositories/supabase-message-reaction.repository';
import { SupabaseReadReceiptRepository } from '../../infrastructure/supabase/repositories/supabase-read-receipt.repository';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
} from '../../domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { NotificationModule } from '../notification/notification.module';
import { ChannelAccessModule } from '../channel-access/channel-access.module';
import { RbacModule } from '../rbac/rbac.module';
import { ActivationModule } from '../activation/activation.module';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';
import { ChatNotificationPreferenceRepository } from '../chat-push-worker/chat-notification-preference.repository';
import { ChannelCacheModule } from '../chat-push-worker/channel-cache.module';

@Module({
  // RbacModule → RbacService, which the delete-message route uses to resolve
  // `channels:manage` for the spec'd moderation path.
  // ChapterModule → MEMBER_REPOSITORY, and AuthModule → USER_REPOSITORY. Both
  // are needed by `sendMessage`'s server-side `@`-mention resolution, which
  // walks the chapter roster to turn an `@`-token into a `users.id`.
  // `ChannelAccessModule` is not a substitute: it exports only its service.
  // `ChannelCacheModule` → `ChannelCacheService`, so `updateChannel` can evict
  // the push worker's cached authorization inputs on write (#988) — imported
  // rather than `ChatPushWorkerModule` itself for the same reason
  // `ChatNotificationPreferenceRepository` is provided directly below: that
  // module's `OnApplicationBootstrap` opens a Realtime subscription, which has
  // no business starting up for a request-path module.
  imports: [
    NotificationModule,
    ChannelAccessModule,
    RbacModule,
    ActivationModule,
    ChapterModule,
    AuthModule,
    ChannelCacheModule,
  ],
  controllers: [ChatController],
  providers: [
    // Provided directly rather than by importing `ChatPushWorkerModule`, which
    // would pull the worker's Realtime subscription lifecycle into the request
    // path for a stateless query helper. The class is the single home for
    // `chat_notification_preferences` reads and writes; a second repository for
    // the same table would be two places for one table's queries to drift.
    ChatNotificationPreferenceRepository,
    ChatService,
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
    {
      provide: CHAT_CATEGORY_REPOSITORY,
      useClass: SupabaseChatCategoryRepository,
    },
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
    {
      provide: CHAT_MESSAGE_ACTION_REPOSITORY,
      useClass: SupabaseChatMessageActionRepository,
    },
    {
      provide: CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
      useClass: SupabaseChatMessageAttachmentRepository,
    },
    {
      provide: MESSAGE_REACTION_REPOSITORY,
      useClass: SupabaseMessageReactionRepository,
    },
    {
      provide: CHANNEL_READ_RECEIPT_REPOSITORY,
      useClass: SupabaseReadReceiptRepository,
    },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [ChatService],
})
export class ChatModule {}
