import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  extractMentionTokens,
  foldMentionName,
  resolveMentions,
  sendMentionReading,
  type MentionRole,
} from '@repo/validation';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import { SystemPermissions } from '#domain/constants/permissions';
import type { ChapterMemberIdentity } from '#domain/entities/member.entity';
import type { Role } from '#domain/entities/role.entity';
import { RbacService } from './rbac.service';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/** A chapter role as the mention picker and the resolver see it. */
export interface MentionRoleView extends MentionRole {
  color: string | null;
  /**
   * The role's own switch (`roles.mentionable`): whether any member may ping
   * it. `mentionable` is that, or the sender being able to ping any role.
   */
  open_to_all: boolean;
}

/**
 * Who a chat message `@`-mentions, and which roles a member may `@`.
 *
 * Split out of `ChatService` when roles became mentionable (2026-11-06, owner
 * direction "roles should be attable"): resolution now needs the chapter's
 * roles and, for a role an officer switched off, the sender's permissions, and the
 * picker needs the same answer the resolver gives, so both read it here.
 *
 * The rule (`spec/behavior/chat/README.md` § Role mentions; owner direction
 * 2026-11-06, "anyone can ping any role by default. officers can change
 * defaults"): any member may `@` a role whose switch is on, which every role's
 * is until an officer turns it off. A role switched off can still be pinged by
 * a member who can manage channels or roles, the way Discord lets a moderator
 * ping a role that is not mentionable.
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
      // name either. A failed roles read costs only the role mentions: member
      // mentions resolved before roles existed, and still do without them.
      const [candidates, roles] = await Promise.all([
        this.memberRepo.findChapterMemberIdentities(chapterId),
        this.rbac.findByChapter(chapterId).catch((error: unknown) => {
          logThrowable(
            this.logger,
            'warn',
            `Failed to read roles for mentions in chapter ${chapterId}; resolving members only`,
            error,
          );
          return [];
        }),
      ]);
      if (candidates.length === 0) return [];

      const views = mentionRoleViews(roles, candidates);
      // The sender's permissions cost two more reads, so they are fetched only
      // when a token names a role that is switched off, the one case they decide.
      // Re-read as the resolver will (`sendMentionReading`), now that the
      // names holding a space are known: a switched-off "Vice President" is
      // named by `@Vice President`, which the bare read above saw as `@Vice`.
      const named = new Set(
        extractMentionTokens(
          content,
          sendMentionReading(candidates, views),
        ).map(foldMentionName),
      );
      const needsOfficer = views.some(
        (view) => !view.open_to_all && named.has(foldMentionName(view.name)),
      );
      const officer = needsOfficer
        ? canPingAnyRole(
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
    const officer = canPingAnyRole(permissions);
    return mentionRoleViews(roles, candidates)
      .filter((view) => view.member_ids.length > 0)
      .map((view) => withMentionable(view, officer));
  }
}

/** Whether a member may ping a role whose switch is off. */
export function canPingAnyRole(permissions: readonly string[]): boolean {
  return (
    permissions.includes(SystemPermissions.WILDCARD) ||
    permissions.includes(SystemPermissions.CHANNELS_MANAGE) ||
    permissions.includes(SystemPermissions.ROLES_MANAGE)
  );
}

/**
 * Every role of the chapter with its holders, in role order, and its own
 * switch. `mentionable` is left for the caller to set, since it depends on
 * who is sending.
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
        // A row read before the column existed has no value: on, its default.
        open_to_all: role.mentionable !== false,
        mentionable: false,
      };
    });
}

function withMentionable(
  view: MentionRoleView,
  officer: boolean,
): MentionRoleView {
  return { ...view, mentionable: officer || view.open_to_all };
}
