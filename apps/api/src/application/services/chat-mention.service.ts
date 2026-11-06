import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  extractMentionTokens,
  foldMentionName,
  resolveMentions,
  type MentionRole,
} from '@repo/validation';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  SystemPermissions,
  SystemRoleKeys,
} from '#domain/constants/permissions';
import type { ChapterMemberIdentity } from '#domain/entities/member.entity';
import type { Role } from '#domain/entities/role.entity';
import { RbacService } from './rbac.service';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/** A chapter role as the mention picker and the resolver see it. */
export interface MentionRoleView extends MentionRole {
  color: string | null;
  /**
   * Whether the role is a whole-chapter ping: the seeded Member role, or any
   * role more than half the chapter holds. Only an officer may send one.
   */
  chapter_wide: boolean;
}

/**
 * Who a chat message `@`-mentions, and which roles a member may `@`.
 *
 * Split out of `ChatService` when roles became mentionable (2026-11-06, owner
 * direction "roles should be attable"): resolution now needs the chapter's
 * roles and, for a whole-chapter role, the sender's permissions, and the
 * picker needs the same answer the resolver gives, so both read it here.
 *
 * The rule (`spec/behavior/chat/README.md` § Role mentions): any member may
 * `@` a role, except a role that covers most of the chapter, which only a
 * member holding `channels:manage` (or the wildcard) may. A mention gets past
 * a mute, so `@Member` from anyone would be a chapter-wide ping no mute stops.
 */
@Injectable()
export class ChatMentionService {
  private readonly logger = new Logger(ChatMentionService.name);

  constructor(
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Every `users.id` that `content` mentions, resolved against the sender's
   * chapter: members by name, and roles by their whole name.
   *
   * Scoped to the chapter rather than the channel. Narrowing to channel
   * members would be tighter, but it is not needed for safety: the push
   * worker builds its recipient list from channel membership and only then
   * asks whether each recipient was mentioned, so a stored mention of a
   * non-member is inert. The chapter roster also keeps `@name` meaning the
   * same thing in every channel, which is what a member typing it expects.
   *
   * Failure is swallowed: a directory lookup that errors must not take the
   * send down with it. The message lands with no mentions, which costs a
   * highlight and a push tier, not the message.
   */
  async resolveForSend(
    chapterId: string,
    senderId: string,
    content: string,
  ): Promise<string[]> {
    // Parse before querying. `content.includes('@')` admits every email
    // address, every `@here`, and every `user@host` in a pasted log, all of
    // which used to buy a full roster fetch on the send hot path. The parser
    // is the same one that resolves the tokens a moment later, so "has a
    // token" and "resolves a token" cannot disagree about what an `@` means.
    const tokens = extractMentionTokens(content);
    if (tokens.length === 0) return [];

    try {
      // `user_id, display_name, role_ids` only: see
      // `findChapterMemberIdentities`. Roles in parallel, since a token can
      // name either.
      const [candidates, roles] = await Promise.all([
        this.memberRepo.findChapterMemberIdentities(chapterId),
        this.rbac.findByChapter(chapterId),
      ]);
      if (candidates.length === 0) return [];

      const views = mentionRoleViews(roles, candidates);
      // The sender's permissions cost two more reads, so they are fetched only
      // when a token names a whole-chapter role, the one case they decide.
      const named = new Set(tokens.map(foldMentionName));
      const needsOfficer = views.some(
        (view) => view.chapter_wide && named.has(foldMentionName(view.name)),
      );
      const officer = needsOfficer
        ? canPingWholeChapter(
            await this.rbac.getEffectivePermissions(chapterId, senderId),
          )
        : false;

      return resolveMentions(
        content,
        candidates,
        views.map((view) => withMentionable(view, officer)),
      );
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Failed to resolve mentions in chapter ${chapterId}; sending without them`,
        error,
      );
      return [];
    }
  }

  /**
   * The chapter's roles as `userId`'s mention picker offers them, in the
   * chapter's role order: each with whether this member may ping it. A role
   * nobody holds is left out, since it would reach nobody.
   */
  async listMentionRoles(
    chapterId: string,
    userId: string,
  ): Promise<MentionRoleView[]> {
    const [candidates, roles, permissions] = await Promise.all([
      this.memberRepo.findChapterMemberIdentities(chapterId),
      this.rbac.findByChapter(chapterId),
      this.rbac.getEffectivePermissions(chapterId, userId),
    ]);
    const officer = canPingWholeChapter(permissions);
    return mentionRoleViews(roles, candidates)
      .filter((view) => view.member_ids.length > 0)
      .map((view) => withMentionable(view, officer));
  }
}

/** Whether a member may send a whole-chapter role ping. */
export function canPingWholeChapter(permissions: readonly string[]): boolean {
  return (
    permissions.includes(SystemPermissions.WILDCARD) ||
    permissions.includes(SystemPermissions.CHANNELS_MANAGE)
  );
}

/**
 * Every role of the chapter with its holders, in role order, and whether it
 * is a whole-chapter ping. `mentionable` is left for the caller to set, since
 * it depends on who is sending.
 */
export function mentionRoleViews(
  roles: readonly Role[],
  members: readonly ChapterMemberIdentity[],
): MentionRoleView[] {
  const holders = new Map<string, string[]>();
  for (const member of members) {
    for (const roleId of member.role_ids) {
      const list = holders.get(roleId);
      if (list) list.push(member.user_id);
      else holders.set(roleId, [member.user_id]);
    }
  }
  return [...roles]
    .sort((a, b) => a.display_order - b.display_order)
    .map((role) => {
      const memberIds = holders.get(role.id) ?? [];
      return {
        role_id: role.id,
        name: role.name,
        color: role.color,
        member_ids: memberIds,
        chapter_wide:
          role.system_key === SystemRoleKeys.MEMBER ||
          memberIds.length * 2 > members.length,
        mentionable: false,
      };
    });
}

function withMentionable(
  view: MentionRoleView,
  officer: boolean,
): MentionRoleView {
  return { ...view, mentionable: officer || !view.chapter_wide };
}
