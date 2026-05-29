import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatChannelRepository } from '../../domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { ChatChannel } from '../../domain/entities/chat.entity';
import { canAccessChannel } from '@repo/validation';
import type { ChannelOperation } from '@repo/validation';
import { RbacService } from './rbac.service';

/**
 * Single source of truth for chat channel-access authorization.
 *
 * Every code path that touches a channel — chat (cold reads + the hot-path
 * send/react controller), polls, and search — resolves the decision here from
 * a TRUSTED database lookup: channel → chapter → membership (and, only when
 * needed, the caller's effective permissions), never from a client-supplied
 * chapter/channel field. Centralizing the rule is what stops the chat and poll
 * surfaces from drifting apart, which is how cross-channel authorization holes
 * appear (see `spec/behavior/chat`, "Channel-access enforcement").
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
   * Authorize a caller for a single channel and return the trusted channel
   * record. `channelRepo.findById(channelId, chapterId)` scopes the channel to
   * the caller's active chapter, so a channel in another chapter resolves to a
   * 404. Visibility (PUBLIC / PRIVATE / ROLE_GATED / DM) — and, for
   * `operation: 'post'`, the read-only gate (`#announcements`,
   * `#chapter-audit`) — is decided by the shared `canAccessChannel` predicate.
   *
   * @throws NotFoundException when the channel does not resolve in the chapter.
   * @throws ForbiddenException when the caller may not access it.
   */
  async assertAccess(
    channelId: string,
    chapterId: string,
    userId: string,
    operation: ChannelOperation = 'read',
  ): Promise<ChatChannel> {
    const channel = await this.channelRepo.findById(channelId, chapterId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const isChapterMember = await this.isChapterMember(userId, chapterId);
    const permissions = await this.resolvePermissions(
      channel,
      operation,
      isChapterMember,
      chapterId,
      userId,
    );

    const allowed = canAccessChannel({
      channel: this.toAccessRecord(channel),
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
   * Return the subset of `channelIds` (within `chapterId`) that `userId` may
   * access for `operation`. Loads chapter membership and — only when a
   * candidate actually needs them — the caller's effective permissions exactly
   * once, so a list surface can filter many channels without an N+1 of
   * per-channel checks. This is the "search is not a side-channel" rule applied
   * to list endpoints: hits in channels the caller can't read are dropped
   * before any of their content (or vote tallies) is assembled.
   */
  async filterAccessibleChannelIds(
    chapterId: string,
    userId: string,
    channelIds: string[],
    operation: ChannelOperation = 'read',
  ): Promise<Set<string>> {
    const accessible = new Set<string>();
    const unique = [...new Set(channelIds)];
    if (unique.length === 0) return accessible;

    const isChapterMember = await this.isChapterMember(userId, chapterId);
    if (!isChapterMember) return accessible;

    const channels = await this.channelRepo.findByChapter(chapterId);
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const candidates = unique
      .map((id) => byId.get(id))
      .filter((channel): channel is ChatChannel => Boolean(channel));

    const needsPermissions = candidates.some((channel) =>
      this.channelNeedsPermissions(channel, operation),
    );
    const permissions = needsPermissions
      ? await this.rbac.getEffectivePermissions(chapterId, userId)
      : [];

    for (const channel of candidates) {
      const allowed = canAccessChannel({
        channel: this.toAccessRecord(channel),
        userId,
        isChapterMember,
        permissions,
        operation,
      });
      if (allowed) accessible.add(channel.id);
    }

    return accessible;
  }

  private async isChapterMember(
    userId: string,
    chapterId: string,
  ): Promise<boolean> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    return Boolean(member);
  }

  /**
   * Effective permissions are only consulted for ROLE_GATED channels and for a
   * `post` against a read-only channel, so we skip the RBAC round-trip
   * otherwise (and always for non-members, who are denied regardless).
   */
  private async resolvePermissions(
    channel: ChatChannel,
    operation: ChannelOperation,
    isChapterMember: boolean,
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    if (!isChapterMember || !this.channelNeedsPermissions(channel, operation)) {
      return [];
    }
    return this.rbac.getEffectivePermissions(chapterId, userId);
  }

  private channelNeedsPermissions(
    channel: ChatChannel,
    operation: ChannelOperation,
  ): boolean {
    return (
      channel.type === 'ROLE_GATED' ||
      (operation === 'post' && channel.is_read_only === true)
    );
  }

  private toAccessRecord(channel: ChatChannel) {
    return {
      type: channel.type,
      member_ids: channel.member_ids,
      required_permissions: channel.required_permissions,
      is_read_only: channel.is_read_only ?? null,
    };
  }
}
