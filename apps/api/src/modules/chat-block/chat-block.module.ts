import { Module } from '@nestjs/common';
import { ChatBlockService } from '../../application/services/chat-block.service';
import { SupabaseChatMemberBlockRepository } from '../../infrastructure/supabase/repositories/supabase-chat-member-block.repository';
import { CHAT_MEMBER_BLOCK_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import { ChapterModule } from '../chapter/chapter.module';

/**
 * Hosts the shared {@link ChatBlockService} (#2257), for the reason
 * `ChannelAccessModule` hosts `ChannelAccessService`: more than one surface
 * owes the same guarantee and must reach it through one code path.
 *
 * Its consumers, and the list is the whole point of the module existing rather
 * than `ChatModule` providing the service privately:
 *
 * - `ChatModule` — the message and pin reads, and the routes that edit the list.
 * - `SearchModule` — full-text message search is a message read surface.
 * - `PollModule` — the poll list and detail serve the author's question and
 *   options (#2495).
 * - `ChatBookmarkService` (in `ChatModule`) — the bookmarks panel re-reads
 *   `chat_messages` on every request.
 * - `ChatPushWorkerModule` — the push audience, which is the severe one: a
 *   notification is content delivered to a lock screen and a persisted row,
 *   past every client-side list.
 *
 * Imports `ChapterModule` for `MEMBER_REPOSITORY`, which the block write uses to
 * check the target is a member of this chapter — the check that stops a stray
 * UUID becoming a foreign-key 500.
 */
@Module({
  imports: [ChapterModule],
  providers: [
    ChatBlockService,
    {
      provide: CHAT_MEMBER_BLOCK_REPOSITORY,
      useClass: SupabaseChatMemberBlockRepository,
    },
  ],
  exports: [ChatBlockService],
})
export class ChatBlockModule {}
