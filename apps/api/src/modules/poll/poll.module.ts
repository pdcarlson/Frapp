import { Module } from '@nestjs/common';
import { PollService } from '../../application/services/poll.service';
import { PollController } from '../../interface/controllers/poll.controller';
import { SupabasePollVoteRepository } from '../../infrastructure/supabase/repositories/supabase-poll-vote.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import {
  CHAT_MESSAGE_REPOSITORY,
  CHAT_CHANNEL_REPOSITORY,
} from '../../domain/repositories/chat.repository.interface';
import { POLL_VOTE_REPOSITORY } from '../../domain/repositories/poll-vote.repository.interface';

@Module({
  controllers: [PollController],
  providers: [
    PollService,
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
    {
      provide: POLL_VOTE_REPOSITORY,
      useClass: SupabasePollVoteRepository,
    },
  ],
  exports: [PollService],
})
export class PollModule {}
