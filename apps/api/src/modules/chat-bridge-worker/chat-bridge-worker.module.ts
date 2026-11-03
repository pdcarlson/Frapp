import { Module } from '@nestjs/common';
import { ChatBridgeWorkerService } from '../../application/workers/chat-bridge-worker.service';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';

/**
 * Audit→chat bridge worker (ADR-08). Runs in-process on the API; the
 * `OnApplicationBootstrap` lifecycle on `ChatBridgeWorkerService` opens
 * the Supabase Realtime subscription. The Supabase client is provided
 * globally via `SupabaseModule`; the two chat repositories are the
 * `#chapter-audit` lookup and the mirror insert.
 */
@Module({
  providers: [
    ChatBridgeWorkerService,
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
export class ChatBridgeWorkerModule {}
