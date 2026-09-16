import { Module } from '@nestjs/common';
import { ChatService } from '../../application/services/chat.service';
import { ChatBookmarkService } from '../../application/services/chat-bookmark.service';
import { ChatReportService } from '../../application/services/chat-report.service';
import { ChatController } from '../../interface/controllers/chat.controller';
import { ChatBookmarkController } from '../../interface/controllers/chat-bookmark.controller';
import { ChatBlockController } from '../../interface/controllers/chat-block.controller';
import { ChatReportController } from '../../interface/controllers/chat-report.controller';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatCategoryRepository } from '../../infrastructure/supabase/repositories/supabase-chat-category.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseChatMessageActionRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-action.repository';
import { SupabaseChatMessageAttachmentRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-attachment.repository';
import { SupabaseMessageReactionRepository } from '../../infrastructure/supabase/repositories/supabase-message-reaction.repository';
import { SupabaseReadReceiptRepository } from '../../infrastructure/supabase/repositories/supabase-read-receipt.repository';
import { SupabaseChatMessageBookmarkRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-bookmark.repository';
import { SupabaseChatMessageReportRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-report.repository';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
  CHAT_MESSAGE_BOOKMARK_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { NotificationModule } from '../notification/notification.module';
import { ChannelAccessModule } from '../channel-access/channel-access.module';
import { RbacModule } from '../rbac/rbac.module';
import { ActivationModule } from '../activation/activation.module';
import { ChapterModule } from '../chapter/chapter.module';
import { ChatNotificationPreferenceRepository } from '../chat-push-worker/chat-notification-preference.repository';
import { ChannelCacheModule } from '../chat-push-worker/channel-cache.module';
import { ChatBlockModule } from '../chat-block/chat-block.module';

@Module({
  // RbacModule → RbacService, which the delete-message route uses to resolve
  // `channels:manage` for the spec'd moderation path.
  // ChapterModule → MEMBER_REPOSITORY, needed by `sendMessage`'s server-side
  // `@`-mention resolution, which walks the chapter roster to turn an
  // `@`-token into a `users.id`.
  // `ChannelAccessModule` is not a substitute: it exports only its service.
  // `ChannelCacheModule` → `ChannelCacheService`, so `updateChannel` can evict
  // the push worker's cached authorization inputs on write (#988) — imported
  // rather than `ChatPushWorkerModule` itself for the same reason
  // `ChatNotificationPreferenceRepository` is provided directly below: that
  // module's `OnApplicationBootstrap` opens a Realtime subscription, which has
  // no business starting up for a request-path module.
  // `ChatBlockModule` → `ChatBlockService` and the block repository. Imported
  // rather than provided here because four modules consume the same rule — see
  // that module's docblock — and a second provider would be a second instance
  // of a safety boundary.
  imports: [
    NotificationModule,
    ChannelAccessModule,
    RbacModule,
    ActivationModule,
    ChapterModule,
    ChannelCacheModule,
    ChatBlockModule,
  ],
  controllers: [
    ChatController,
    ChatBookmarkController,
    // Report and block (#2257) live beside chat rather than in a module of
    // their own: both need `ChannelAccessService` and `MEMBER_REPOSITORY`,
    // which this module already imports, and `ChatService.getMessages`
    // injects `ChatBlockService` to mask what it serves.
    ChatReportController,
    ChatBlockController,
  ],
  providers: [
    // Provided directly rather than by importing `ChatPushWorkerModule`, which
    // would pull the worker's Realtime subscription lifecycle into the request
    // path for a stateless query helper. The class is the single home for
    // `chat_notification_preferences` reads and writes; a second repository for
    // the same table would be two places for one table's queries to drift.
    ChatNotificationPreferenceRepository,
    ChatService,
    // Bookmarks (#462) share this module's wiring but not `ChatService` — see
    // the service's own docblock for why they are a separate class.
    ChatBookmarkService,
    // Member-side moderation (#2257). A separate service for the same reason
    // bookmarks are: it shares the authorization seam with the chat hot path
    // and nothing else. `ChatBlockService` is NOT provided here — it comes from
    // `ChatBlockModule` above, so the push worker and search resolve the same
    // instance of the same rule.
    ChatReportService,
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
    {
      provide: CHAT_MESSAGE_BOOKMARK_REPOSITORY,
      useClass: SupabaseChatMessageBookmarkRepository,
    },
    {
      provide: CHAT_MESSAGE_REPORT_REPOSITORY,
      useClass: SupabaseChatMessageReportRepository,
    },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [ChatService],
})
export class ChatModule {}
