import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { NotificationService } from './notification.service';
import { CHAT_SINCE_NOT_FOUND_CODE } from '@repo/validation';
import {
  CHAT_MESSAGE_REPOSITORY,
  ChatMessageCursorNotFoundError,
  type IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import {
  CHAT_THREAD_REPOSITORY,
  type IChatThreadRepository,
} from '#domain/repositories/chat-thread.repository.interface';
import type {
  ChatChannel,
  ChatMessage,
  ChatThreadFollowState,
  FollowedThreadUnread,
  MemberThreadRow,
} from '#domain/entities/chat.entity';
import { channelAllowsThreads } from '#domain/utils/channel-access';
import { clampListLimit } from '#domain/constants/list-query-limits';
import { ChannelAccessService } from './channel-access.service';
import { ChatBlockService } from './chat-block.service';
import { maskBlockedMessages, type MaskedChatMessage } from './chat-block-mask';
import { instantOrThrow } from './instant-bound';

/** What `GET /v1/channels/:id/threads/:rootId` answers. */
export interface ChatThreadView {
  root: MaskedChatMessage;
  /** The caller's state; `null` when not following. */
  follow_state: ChatThreadFollowState | null;
  last_read_at: string | null;
}

/** One row of `GET /v1/threads` (#4960). */
export interface MemberThreadView extends Omit<
  MemberThreadRow,
  'latest_reply_id'
> {
  root: MaskedChatMessage;
  /** The newest reply, or `null` when every reply was deleted. */
  latest_reply: MaskedChatMessage | null;
}

/** How many threads All threads shows; the newest activity wins. */
export const MEMBER_THREADS_LIMIT = 50;

/** `PUT …/follow`: `none` unfollows. */
export type ChatThreadFollowChoice = ChatThreadFollowState | 'none';

/**
 * Message threads (#3785): reading a thread, following or muting it, and its
 * read cursor. Posting a reply is `ChatService.sendMessage` with
 * `thread_root_id`, so the hot path's checks (dedupe, attachments, mentions,
 * module gates) are not copied here.
 *
 * Every method authorizes the channel for `read` and then resolves the root
 * inside it, so a root id from another channel, or a thread reply passed as a
 * root, is a 404 like any message the caller cannot see.
 */
@Injectable()
export class ChatThreadService {
  constructor(
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHAT_THREAD_REPOSITORY)
    private readonly threads: IChatThreadRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly chatBlocks: ChatBlockService,
    private readonly notifications: NotificationService,
  ) {}

  private readonly logger = new Logger(ChatThreadService.name);

  async getThread(
    channelId: string,
    rootId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatThreadView> {
    const { root } = await this.resolveRoot(
      channelId,
      rootId,
      chapterId,
      userId,
    );
    const [follow, blocked] = await Promise.all([
      this.threads.findFollow(root.id, userId),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    const [masked] = maskBlockedMessages([root], blocked);
    return {
      root: masked,
      follow_state:
        follow && follow.state !== 'unfollowed' ? follow.state : null,
      last_read_at: follow?.last_read_at ?? null,
    };
  }

  /** A thread's replies, paged exactly like the timeline (`getMessages`). */
  async getReplies(
    channelId: string,
    rootId: string,
    chapterId: string,
    userId: string,
    options?: { limit?: number; before?: string; since?: string },
  ): Promise<MaskedChatMessage[]> {
    const { root } = await this.resolveRoot(
      channelId,
      rootId,
      chapterId,
      userId,
    );
    instantOrThrow('before', options?.before);
    const [replies, blocked] = await Promise.all([
      this.threads
        .findReplies(root.id, {
          ...options,
          limit: clampListLimit(options?.limit),
        })
        .catch((error: unknown) => {
          if (error instanceof ChatMessageCursorNotFoundError) {
            throw new NotFoundException({
              code: CHAT_SINCE_NOT_FOUND_CODE,
              message: 'The since message is not in this thread',
            });
          }
          throw error;
        }),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    return maskBlockedMessages(replies, blocked);
  }

  async setFollow(
    channelId: string,
    rootId: string,
    chapterId: string,
    userId: string,
    choice: ChatThreadFollowChoice,
  ): Promise<{ follow_state: ChatThreadFollowState | null }> {
    const { root, channel } = await this.resolveRoot(
      channelId,
      rootId,
      chapterId,
      userId,
    );
    this.assertThreadable(channel);
    const state = choice === 'none' ? null : choice;
    await this.threads.setFollowState(root.id, channel.id, userId, state);
    return { follow_state: state };
  }

  async markRead(
    channelId: string,
    rootId: string,
    chapterId: string,
    userId: string,
  ): Promise<{ last_read_at: string }> {
    const { root, channel } = await this.resolveRoot(
      channelId,
      rootId,
      chapterId,
      userId,
    );
    this.assertThreadable(channel);
    const readAt = new Date().toISOString();
    await this.threads.markRead(root.id, channel.id, userId, readAt);
    // The thread's pushes leave the inbox with it, as a channel read clears
    // the channel's (#3788). Best-effort: a stale inbox dot must not fail the
    // cursor that drives the counts.
    await this.notifications
      .markChatChannelNotificationsRead(
        userId,
        chapterId,
        channel.id,
        readAt,
        root.id,
      )
      .catch((error: unknown) =>
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'chat-thread-read-clears-notifications',
          message: `Could not clear thread notifications for ${root.id}`,
          error,
        }),
      );
    return { last_read_at: readAt };
  }

  /** The caller's followed and muted threads in a channel, with new-reply counts. */
  async getFollowedThreads(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<FollowedThreadUnread[]> {
    await this.channelAccess.assertChannelAccess(channelId, chapterId, userId);
    return this.threads.findFollowedUnread(channelId, userId);
  }

  /**
   * All threads (#4960): every thread the caller follows or muted, across the
   * channels they may still read, newest activity first. A follow in a channel
   * they lost access to is left out before the limit applies, so it never
   * takes a slot or leaks a root.
   */
  async getMemberThreads(
    chapterId: string,
    userId: string,
  ): Promise<MemberThreadView[]> {
    const followedIn = await this.threads.findFollowedChannelIds(userId);
    const readable = await this.channelAccess.filterAccessibleChannelIds(
      chapterId,
      userId,
      followedIn,
    );
    if (readable.size === 0) return [];
    const rows = await this.threads.findMemberThreads(
      chapterId,
      userId,
      [...readable],
      MEMBER_THREADS_LIMIT,
    );
    if (rows.length === 0) return [];
    const [messages, blocked] = await Promise.all([
      this.threads.findMessagesByIds([
        ...rows.map((row) => row.thread_root_id),
        ...rows.flatMap((row) =>
          row.latest_reply_id ? [row.latest_reply_id] : [],
        ),
      ]),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    const byId = new Map(
      maskBlockedMessages(messages, blocked).map((message) => [
        message.id,
        message,
      ]),
    );
    const views: MemberThreadView[] = [];
    for (const { latest_reply_id, ...row } of rows) {
      const root = byId.get(row.thread_root_id);
      // A root removed between the two reads (a channel purge) drops out.
      if (!root || root.channel_id !== row.channel_id) continue;
      const reply = latest_reply_id ? byId.get(latest_reply_id) : undefined;
      views.push({
        ...row,
        root,
        latest_reply:
          reply && reply.thread_root_id === row.thread_root_id ? reply : null,
      });
    }
    return views;
  }

  private async resolveRoot(
    channelId: string,
    rootId: string,
    chapterId: string,
    userId: string,
  ): Promise<{ root: ChatMessage; channel: ChatChannel }> {
    const channel = await this.channelAccess.assertChannelAccess(
      channelId,
      chapterId,
      userId,
    );
    const root = await this.messageRepo.findById(rootId);
    if (!root || root.channel_id !== channel.id || root.thread_root_id) {
      throw new NotFoundException('Thread not found');
    }
    return { root, channel };
  }

  /** Following and reading write a row, so a channel without threads refuses them. */
  private assertThreadable(channel: ChatChannel): void {
    if (!channelAllowsThreads(channel)) {
      throw new BadRequestException('This channel does not take threads');
    }
  }
}
