import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatChannelRepository } from '../../domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { ChatChannel } from '../../domain/entities/chat.entity';
import { canAccessChannel } from '@repo/validation';
import { RbacService } from './rbac.service';

/**
 * Single source of truth for chat channel-level authorization. Both the chat
 * hot path (`ChatService`) and the poll surface (`PollService`) authorize
 * through this service so the two cannot drift: every read / send / vote is
 * decided by the shared `canAccessChannel` predicate against the same
 * channel + membership + effective-permissions lookups.
 *
 * Channel-level visibility (PUBLIC / PRIVATE / ROLE_GATED / DM / GROUP_DM) is
 * decided by `canAccessChannel`, which the retired Edge Functions also reused.
 */
@Injectable()
export class ChannelAccessService {
  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Resolve a channel within the caller's chapter and assert the caller may
   * `read` or `post` to it. A channel in another chapter resolves to a 404
   * (the chapter scope holds); a channel the caller cannot see/post to
   * resolves to a 403. Returns the channel so callers can reuse it.
   */
  async assertChannelAccess(
    channelId: string,
    chapterId: string,
    userId: string,
    operation: 'read' | 'post' = 'read',
  ): Promise<ChatChannel> {
    const channel = await this.channelRepo.findById(channelId, chapterId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    const isChapterMember = Boolean(member);

    // For "post" against a read-only channel (#announcements, #chapter-audit)
    // we need to evaluate the caller's permissions even on a PUBLIC channel
    // so the announcements:post gate can fire.
    const needsPermissions =
      isChapterMember &&
      (channel.type === 'ROLE_GATED' ||
        (operation === 'post' && channel.is_read_only === true));
    const permissions = needsPermissions
      ? await this.rbac.getEffectivePermissions(chapterId, userId)
      : [];

    const allowed = canAccessChannel({
      channel: {
        type: channel.type,
        member_ids: channel.member_ids,
        required_permissions: channel.required_permissions,
        is_read_only: channel.is_read_only ?? null,
      },
      userId,
      isChapterMember,
      permissions,
      operation,
    });

    if (!allowed) {
      throw new ForbiddenException('You do not have access to this channel');
    }

    return channel;
  }

  /**
   * Reduce a set of channel ids to those the caller may `read`, decided by the
   * shared predicate. Mirrors the batch pattern used by search so a chapter-wide
   * list (e.g. `GET /v1/polls`) cannot become a side-channel that leaks the
   * content of private, DM, or role-gated channels the caller is not in.
   *
   * Loads channels, membership, and effective permissions at most once each;
   * permissions are only fetched when a ROLE_GATED channel is among the
   * candidates.
   */
  async filterAccessibleChannelIds(
    chapterId: string,
    userId: string,
    channelIds: string[],
  ): Promise<Set<string>> {
    const wanted = new Set(channelIds);
    if (wanted.size === 0) return new Set();

    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) return new Set();

    const channels = await this.channelRepo.findByChapter(chapterId);
    const candidates = channels.filter((channel) => wanted.has(channel.id));
    if (candidates.length === 0) return new Set();

    const needsPermissions = candidates.some(
      (channel) => channel.type === 'ROLE_GATED',
    );
    const permissions = needsPermissions
      ? await this.rbac.getEffectivePermissions(chapterId, userId)
      : [];

    const accessible = new Set<string>();
    for (const channel of candidates) {
      const allowed = canAccessChannel({
        channel: {
          type: channel.type,
          member_ids: channel.member_ids,
          required_permissions: channel.required_permissions,
          is_read_only: channel.is_read_only ?? null,
        },
        userId,
        isChapterMember: true,
        permissions,
        operation: 'read',
      });
      if (allowed) accessible.add(channel.id);
    }
    return accessible;
  }
}
