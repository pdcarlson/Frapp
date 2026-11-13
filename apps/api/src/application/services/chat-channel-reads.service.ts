import { Injectable } from '@nestjs/common';
import { ChatService } from './chat.service';

/**
 * The two reads of `ChatService` that Ask's conversation tools need
 * (#4900), and nothing else of it.
 *
 * `ChatService` also sends messages and marks channels read, and a tool
 * that answers a question must do neither (`spec/behavior/ai.md` § Asking
 * from a channel; `ask/ask-posts-nothing.spec.ts` refuses the import
 * anywhere under `ask/`). A tool holds this class instead, so the only
 * things it can ask chat for are the member's channel list and their
 * unread counts: `GET /v1/channels` and `GET /v1/channels/unread`, through
 * the methods those routes call.
 */
@Injectable()
export class ChatChannelReadsService {
  constructor(private readonly chat: ChatService) {}

  /** The channels this member can open, as their channel list has them. */
  list(
    chapterId: string,
    userId: string,
  ): ReturnType<ChatService['getChannels']> {
    return this.chat.getChannels(chapterId, userId);
  }

  /** This member's unread counts, per channel. Marks nothing read. */
  unreadCounts(
    chapterId: string,
    userId: string,
  ): ReturnType<ChatService['getUnreadCounts']> {
    return this.chat.getUnreadCounts(chapterId, userId);
  }
}
