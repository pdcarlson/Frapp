import { Injectable } from '@nestjs/common';
import { ChatService } from './chat.service';

/**
 * The two reads of `ChatService` that Ask's conversation tools need
 * (#4900), and nothing else of it.
 *
 * `ChatService` also sends messages and marks channels read, and a tool
 * that answers a question must do neither (`spec/behavior/ai.md` § Asking
 * from a channel). The tools' own spec refuses an import of `ChatService`
 * in their folder (`ask/agent/tools-conversations/conversation-tools.spec.ts`).
 * A tool holds this class instead, so the only things it can ask chat for
 * are the member's channels and their unread counts.
 *
 * `unreadCounts` is the method `GET /v1/channels/unread` calls. `list` is
 * `getChannels`, which `GET /v1/channels` does not call: the route calls
 * `getChannelList`, the same channels with one more lookup for which direct
 * messages the member hid. No tool reads a direct message, so that lookup
 * would be paid for and thrown away.
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
