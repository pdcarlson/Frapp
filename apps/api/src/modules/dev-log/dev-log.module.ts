import { Module } from '@nestjs/common';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import { DevLogService } from '../../application/services/dev-log.service';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { DevLogController } from '../../interface/controllers/dev-log.controller';
import { DevLogTokenGuard } from '../../interface/guards/dev-log-token.guard';

@Module({
  controllers: [DevLogController],
  providers: [
    DevLogService,
    DevLogTokenGuard,
    // Provided here, as `ActivityModule` does: they are stateless query
    // classes, and `ChatModule` exports services only.
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
  ],
})
export class DevLogModule {}
