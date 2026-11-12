import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EVERYONE_MENTION_NAME,
  extractMentionTokens,
  foldMentionName,
  isEveryoneRole,
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
import type { ChatMessage } from '#domain/entities/chat.entity';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import { RbacService } from './rbac.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

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
    replyTo: ReplyTarget | null = null,
  ): Promise<string[]> {
    return withMention(
      await this.resolveBody(chapterId, senderId, content),
      replyPingTarget(senderId, replyTo),
    );
  }

  /**
   * The mentions of an edited message: its new body resolved as a send's is,
   * plus the reply ping exactly as the send stored it (#3844). The ping is
   * kept, not re-decided: the reply still quotes its author, so a later
   * deletion of the quoted message must not take it off their badge, and a
   * reply sent without one (before replies pinged) must not gain one, unheard,
   * on its first edit.
   *
   * `quotedAuthorId` is `undefined` when the quoted message could not be read.
   * Then every previous mention is kept: an edit cannot tell the ping apart,
   * and losing it to a read blip is worse than keeping a name the edit removed.
   */
  async resolveForEdit(
    chapterId: string,
    senderId: string,
    content: string,
    previousMentions: readonly string[],
    quotedAuthorId: string | null | undefined,
  ): Promise<string[]> {
    const body = await this.resolveBody(chapterId, senderId, content);
    if (quotedAuthorId === undefined) {
      return previousMentions.reduce(withMention, body);
    }
    return withMention(
      body,
      quotedAuthorId && previousMentions.includes(quotedAuthorId)
        ? quotedAuthorId
        : null,
    );
  }

  private async resolveBody(
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
          // Only the role mentions are lost, and the member ones still
          // land: `warning` (#4096).
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'chat-mention-roles-read',
            message: `Failed to read roles for mentions in chapter ${chapterId}; resolving members only`,
            error,
          });
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
      // `error`: the message still sends, but everyone it named goes
      // unpinged and is never pinged later, so a fault here (a broken query,
      // a schema the code no longer matches) silently breaks every mention
      // in the chapter (#4096).
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'chat-mention-resolve',
        message: `Failed to resolve mentions in chapter ${chapterId}; sending without them`,
        error,
      });
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

/** The parts of a quoted message the reply ping reads. */
export type ReplyTarget = Pick<ChatMessage, 'sender_id' | 'is_deleted'>;

/**
 * Who a reply pings: the author of the message it quotes, or `null` (#3844,
 * `spec/behavior/chat/README.md` § Mentions). A reply counts as an @mention of
 * them, as Discord's replies do by default, so it rides `mentions` and the
 * push, the `@ N` badge, the highlight and the notification row all follow,
 * once however many ways the author got in.
 *
 * Nobody for a reply to yourself, to a deleted message, or to a row with no
 * linked member (an imported row nobody claimed) or the system actor's.
 *
 * **No block check, on purpose**, as a typed @mention has none. `mentions`
 * reaches the replier, so dropping the author for a block would tell them they
 * had been blocked (`§ Report and block`: nothing may become an oracle for
 * it). Blocks are applied where the ping is delivered instead: the push worker
 * drops a recipient who blocked the sender, and the unread counts skip a
 * blocked member's messages.
 */
export function replyPingTarget(
  senderId: string,
  replyTo: ReplyTarget | null,
): string | null {
  const authorId = replyTo?.sender_id ?? null;
  if (
    !authorId ||
    authorId === senderId ||
    authorId === SYSTEM_SENDER_ID ||
    replyTo?.is_deleted
  ) {
    return null;
  }
  return authorId;
}

/** `ids` plus `id`, once. */
function withMention(ids: string[], id: string | null): string[] {
  return id && !ids.includes(id) ? [...ids, id] : ids;
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
      // The Everyone role is `@everyone` (#4191): it reaches every member of
      // the chapter, not only the members whose rows hold it, and it is named
      // as Discord writes it. Whether the sender may use it is still the
      // role's own switch, which is off for Everyone until a chapter opens it.
      const everyone = isEveryoneRole(role);
      const memberIds = everyone
        ? members.map((member) => member.user_id)
        : (holders.get(role.id) ?? []);
      return {
        role_id: role.id,
        name: everyone ? EVERYONE_MENTION_NAME : role.name,
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
