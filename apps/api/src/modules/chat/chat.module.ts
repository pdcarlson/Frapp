import { Module } from '@nestjs/common';
import { ChatService } from '../../application/services/chat.service';
import { ChatController } from '../../interface/controllers/chat.controller';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatCategoryRepository } from '../../infrastructure/supabase/repositories/supabase-chat-category.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseMessageReactionRepository } from '../../infrastructure/supabase/repositories/supabase-message-reaction.repository';
import { SupabaseReadReceiptRepository } from '../../infrastructure/supabase/repositories/supabase-read-receipt.repository';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
} from '../../domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [ChatController],
  providers: [
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
