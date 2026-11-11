import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CHAT_MESSAGE_LINK_REPOSITORY } from '#domain/repositories/chat-message-link.repository.interface';
import type { IChatMessageLinkRepository } from '#domain/repositories/chat-message-link.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type {
  ChannelType,
  ChatLinkMemberStateValue,
  ChatMessageLink,
} from '#domain/entities/chat.entity';
import { ChatBlockService } from './chat-block.service';
import { ChatService } from './chat.service';

/** How long a link shows on Activity, from when it was posted. */
export const ACTIVITY_LINK_WINDOW_DAYS = 30;
/** Rows the Links list carries, like every Activity list. */
const LINK_LIST_LIMIT = 25;
/**
 * How many of the newest showing links in the caller's channels are read
 * before their own, blocked and Done or Hidden ones are dropped. A member
 * would need 175 of those inside 30 days to lose a row to it.
 */
const LINK_SCAN_LIMIT = 200;

/** A sign-up link on the caller's Activity page. */
export interface ActivityLink {
  id: string;
  url: string;
  /** Lower-cased, without `www.`: what a row shows as where the link goes. */
  host: string;
  /** The chat message it was posted in, for "Open in chat". */
  message_id: string;
  channel_id: string;
  /** The channel's name; a direct message's is server-generated, so use `channel_type`. */
  channel_name: string;
  channel_type: ChannelType;
  /** Null for an imported author with no Frapp account. */
  posted_by: string | null;
  /** Empty when the poster cannot be resolved. */
  posted_by_name: string;
  posted_at: string;
}

/**
 * Links on Activity (#3897, `spec/behavior/activity.md` § Links): the read
 * behind the Links section, each member's Done and Hide, and an officer's
 * remove for everyone.
 *
 * The channel access rule is chat's own: a link is listed only from a channel
 * in {@link ChatService.getChannels}, the list chat shows this caller, and a
 * state is set only on a link whose channel {@link ChatService.getChannel}
 * lets them read. The index itself is written by database triggers on
 * `chat_messages`, never here.
 */
@Injectable()
export class ActivityLinkService {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatBlocks: ChatBlockService,
    @Inject(CHAT_MESSAGE_LINK_REPOSITORY)
    private readonly linkRepo: IChatMessageLinkRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
  ) {}

  /**
   * The caller's links, newest first, at most 25: posted in the last 30 days
   * in a channel they can read that is not left out of Activity, not removed
   * by an officer, not their own, not from a member they blocked, and not
   * marked Done or Hidden by them.
   *
   * The block list is read, not defended against: one that cannot be read
   * fails the read (and the section) rather than listing unmasked.
   */
  async listFor(
    chapterId: string,
    userId: string,
    now: number,
  ): Promise<ActivityLink[]> {
    const [channels, blockedUserIds] = await Promise.all([
      this.chatService.getChannels(chapterId, userId),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    const feeding = new Map(
      channels
        .filter((channel) => channel.activity_excluded !== true)
        .map((channel) => [channel.id, channel]),
    );
    const since = new Date(
      now - ACTIVITY_LINK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const showing = await this.linkRepo.findShowing(chapterId, {
      since,
      channelIds: [...feeding.keys()],
      limit: LINK_SCAN_LIMIT,
    });
    const blocked = new Set(blockedUserIds);
    const candidates = showing.filter(
      (link) =>
        feeding.has(link.channel_id) &&
        link.posted_by !== userId &&
        !(link.posted_by && blocked.has(link.posted_by)),
    );
    const states = await this.linkRepo.findStates(
      chapterId,
      userId,
      candidates.map((link) => link.id),
    );
    const settled = new Set(states.map((state) => state.link_id));
    const listed = candidates
      .filter((link) => !settled.has(link.id))
      .slice(0, LINK_LIST_LIMIT);

    const names = await this.namesOf(
      listed.flatMap((link) => (link.posted_by ? [link.posted_by] : [])),
    );
    return listed.flatMap((link) => {
      const channel = feeding.get(link.channel_id);
      if (!channel) return [];
      return {
        id: link.id,
        url: link.url,
        host: link.host,
        message_id: link.message_id,
        channel_id: link.channel_id,
        channel_name: channel.name,
        channel_type: channel.type,
        posted_by: link.posted_by,
        posted_by_name: link.posted_by ? (names.get(link.posted_by) ?? '') : '',
        posted_at: link.posted_at,
      };
    });
  }

  /** Marks a link Done or Hidden for the caller. Idempotent. */
  async setState(
    chapterId: string,
    userId: string,
    linkId: string,
    state: ChatLinkMemberStateValue,
  ): Promise<void> {
    await this.requireReadableLink(chapterId, userId, linkId);
    await this.linkRepo.setState(chapterId, linkId, userId, state);
  }

  /** Clears the caller's Done or Hide, so the link shows again. Idempotent. */
  async clearState(
    chapterId: string,
    userId: string,
    linkId: string,
  ): Promise<void> {
    await this.requireReadableLink(chapterId, userId, linkId);
    await this.linkRepo.clearState(chapterId, linkId, userId);
  }

  /**
   * An officer's remove for everyone (`removedBy` set), or its undo (`null`).
   * The route requires `channels:manage`, and like chat's other
   * `channels:manage` actions this is chapter-scoped, not gated on reading
   * the channel.
   */
  async setRemoved(
    chapterId: string,
    linkId: string,
    removedBy: string | null,
  ): Promise<void> {
    const updated = await this.linkRepo.setRemoved(
      chapterId,
      linkId,
      removedBy,
    );
    if (!updated) throw new NotFoundException('Link not found');
  }

  /**
   * A link in the chapter whose channel the caller can read. A link they
   * can't read answers as missing, so the route can't be used to learn which
   * links exist in channels they can't see.
   */
  private async requireReadableLink(
    chapterId: string,
    userId: string,
    linkId: string,
  ): Promise<ChatMessageLink> {
    const link = await this.linkRepo.findById(chapterId, linkId);
    if (!link) throw new NotFoundException('Link not found');
    try {
      await this.chatService.getChannel(link.channel_id, chapterId, userId);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw new NotFoundException('Link not found');
      }
      throw error;
    }
    return link;
  }

  /** Display names by user id. An id with no user row is simply absent. */
  private async namesOf(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const users = await this.userRepo.findDisplayIdentitiesByIds(unique);
    return new Map(users.map((user) => [user.id, user.display_name ?? '']));
  }
}
