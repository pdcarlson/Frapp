import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EVERYONE_MENTION_NAME,
  extractMentionTokens,
  foldMentionName,
  HERE_MENTION_NAME,
  isEveryoneRole,
  reservedMentionName,
  resolveMentions,
  sendMentionReading,
  type MentionPick,
  type MentionRole,
} from '@repo/validation';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import { SystemPermissions } from '#domain/constants/permissions';
import type { ChapterMemberIdentity } from '#domain/entities/member.entity';
import type { Role, RoleTier } from '#domain/entities/role.entity';
import type {
  ChapterGroup,
  ChapterGroupMembership,
} from '#domain/entities/chapter-group.entity';
import {
  ROLE_TIER_REPOSITORY,
  type IRoleTierRepository,
} from '#domain/repositories/role-tier.repository.interface';
import {
  CHAPTER_GROUP_REPOSITORY,
  type IChapterGroupRepository,
} from '#domain/repositories/chapter-group.repository.interface';
import type { ChatMessage } from '#domain/entities/chat.entity';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import { RbacService } from './rbac.service';
import { ChapterPresenceReader } from './chapter-presence-reader.service';
import { withMembers } from './chapter-group.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/**
 * A chapter role, tier or group as the mention picker and the resolver see
 * it. `role_id` is the tier's or group's id for those (#4076).
 */
export interface MentionRoleView extends MentionRole {
  kind: 'role' | 'tier' | 'group';
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
    private readonly presence: ChapterPresenceReader,
    @Inject(ROLE_TIER_REPOSITORY)
    private readonly tierRepo: IRoleTierRepository,
    @Inject(CHAPTER_GROUP_REPOSITORY)
    private readonly groupRepo: IChapterGroupRepository,
  ) {}

  /**
   * The chapter's tiers and groups with who is in each (#4076), for the
   * resolver and the picker. A failed read costs only those mentions, as a
   * failed roles read costs only the role ones.
   */
  private async readSets(chapterId: string): Promise<MentionSets> {
    const lost = (site: string, what: string) => (error: unknown) => {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site,
        message: `Failed to read ${what} for mentions in chapter ${chapterId}; resolving without them`,
        error,
      });
      return null;
    };
    const [tiers, groups] = await Promise.all([
      this.tierRepo
        .findByChapter(chapterId)
        .catch(lost('chat-mention-tiers-read', 'tiers')),
      Promise.all([
        this.groupRepo.findByChapter(chapterId),
        this.groupRepo.findMemberships(chapterId),
      ]).catch(lost('chat-mention-groups-read', 'groups')),
    ]);
    return {
      tiers: tiers ?? [],
      groups: groups?.[0] ?? [],
      memberships: groups?.[1] ?? [],
    };
  }

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
    picks: readonly MentionPick[] = [],
  ): Promise<string[]> {
    return withMention(
      await this.resolveBody(chapterId, senderId, content, 'read', picks),
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
   *
   * `@here` is not re-read on an edit: it keeps the members the previous
   * body's `@here` reached, so an edit never pings someone who came online
   * since, and one that adds `@here` pings nobody new, as on Discord.
   *
   * `picks` are the members picked into the previous body and the new one
   * (#3835), each read with its own.
   */
  async resolveForEdit(
    chapterId: string,
    senderId: string,
    content: string,
    previousMentions: readonly string[],
    quotedAuthorId: string | null | undefined,
    previousContent: string = '',
    picks: EditPicks = { previous: [], next: [] },
  ): Promise<string[]> {
    const body = await this.resolveBody(
      chapterId,
      senderId,
      content,
      { previousContent, previousMentions, previousPicks: picks.previous },
      picks.next,
    );
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

  /**
   * `here` says who `@here` may reach: `'read'` reads who is online now (a
   * send), and an edit's previous body and mentions say who it reached then
   * ({@link reachedByHere}).
   */
  private async resolveBody(
    chapterId: string,
    senderId: string,
    content: string,
    here: HereSource,
    picks: readonly MentionPick[] = [],
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
      const [candidates, sets, roles] = await Promise.all([
        this.memberRepo.findChapterMemberIdentities(chapterId),
        this.readSets(chapterId),
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

      const views = mentionRoleViews(roles, candidates, sets);
      // The sender's permissions cost two more reads, so they are fetched only
      // when a token names a role that is switched off, the one case they decide.
      // Re-read as the resolver will (`sendMentionReading`), now that the
      // names holding a space are known: a switched-off "Vice President" is
      // named by `@Vice President`, which the bare read above saw as `@Vice`.
      const named = new Set(
        extractMentionTokens(
          content,
          sendMentionReading(candidates, views, picks),
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
      const allowed = views.map((view) => withMentionable(view, officer));

      // Who `@here` reaches is worked out only once the sender may use it:
      // reading who is online is a join on the chapter's presence topic, the
      // costliest read here, and neither an ordinary send nor a member's
      // `@here` that reaches nobody should wait on it.
      const hereView = allowed.find((view) => view.name === HERE_MENTION_NAME);
      if (
        hereView?.mentionable &&
        tokens.some((token) => foldMentionName(token) === HERE_MENTION_NAME)
      ) {
        hereView.member_ids =
          here === 'read'
            ? [...((await this.presence.onlineUserIds(chapterId)) ?? [])]
            : reachedByHere(here, candidates, allowed);
      }

      return resolveMentions(content, candidates, allowed, picks);
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
   * chapter's role order, then its tiers and groups (#4076): each with whether
   * this member may ping it. One nobody holds is left out, since it would
   * reach nobody.
   */
  async listMentionRoles(
    chapterId: string,
    userId: string,
  ): Promise<MentionRoleView[]> {
    const [candidates, roles, permissions, sets] = await Promise.all([
      this.memberRepo.findChapterMemberIdentities(chapterId),
      this.rbac.findByChapter(chapterId),
      this.rbac.getEffectivePermissions(chapterId, userId),
      this.readSets(chapterId),
    ]);
    const officer = canPingAnyRole(permissions);
    // `@here` holds nobody here, so it is left out with the empty roles: it
    // is no role, and the clients add its row after `@everyone`'s
    // (`withHereMention`), which is the switch it follows.
    return mentionRoleViews(roles, candidates, sets)
      .filter((view) => view.member_ids.length > 0)
      .map((view) => withMentionable(view, officer));
  }
}

/** Where `@here`'s members come from: read now (a send), or an edit's earlier body. */
type HereSource =
  | 'read'
  | {
      previousContent: string;
      previousMentions: readonly string[];
      /** The picks the earlier body was read with (#3835). */
      previousPicks?: readonly MentionPick[];
    };

/** An edit's picks: the ones its earlier body was read with, and the new body's. */
export interface EditPicks {
  previous: readonly MentionPick[];
  next: readonly MentionPick[];
}

/**
 * The members an edited message's earlier `@here` reached: its mentions less
 * the ones its body names otherwise, by name or role. None when the earlier
 * body had no `@here`, so an edit that adds it reaches nobody new. A member
 * both named and reached by `@here` counts as named, so editing their name
 * out takes the mention away, as editing out any name does.
 */
function reachedByHere(
  edit: Exclude<HereSource, 'read'>,
  candidates: readonly ChapterMemberIdentity[],
  views: readonly MentionRoleView[],
): string[] {
  const hadHere = extractMentionTokens(edit.previousContent).some(
    (token) => foldMentionName(token) === HERE_MENTION_NAME,
  );
  if (!hadHere) return [];
  const named = new Set(
    resolveMentions(
      edit.previousContent,
      candidates,
      views.filter((view) => view.name !== HERE_MENTION_NAME),
      edit.previousPicks ?? [],
    ),
  );
  return edit.previousMentions.filter((id) => !named.has(id));
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
function replyPingTarget(
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
 * switch, then `@here`. `mentionable` is left for the caller to set, since it
 * depends on who is sending.
 *
 * `@here` (2026-11-12) holds nobody yet: `resolveBody` fills it with the
 * members online once the sender may use it. It follows the Everyone role's
 * switch, as Discord's one permission covers `@everyone` and `@here`, and is
 * officers-only where a chapter has no Everyone role. With no roles read at
 * all (a failed read) there is no `@here`, so the token reaches nobody without
 * asking for the sender's permissions, which would fail the same way. A role
 * an older chapter named "Here" before the name was reserved is left out, so
 * the token means one thing.
 */
export function mentionRoleViews(
  roles: readonly Role[],
  members: readonly ChapterMemberIdentity[],
  sets: Partial<MentionSets> = {},
): MentionRoleView[] {
  const holders = new Map<string, string[]>();
  for (const member of members) {
    for (const roleId of member.role_ids) {
      const list = holders.get(roleId);
      if (list) list.push(member.user_id);
      else holders.set(roleId, [member.user_id]);
    }
  }
  const views: MentionRoleView[] = [...roles]
    .filter(
      (role) =>
        isEveryoneRole(role) ||
        reservedMentionName(role.name) !== HERE_MENTION_NAME,
    )
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
        kind: 'role' as const,
        name: everyone ? EVERYONE_MENTION_NAME : role.name,
        color: role.color,
        member_ids: memberIds,
        // A row read before the column existed has no value: on, its default.
        open_to_all: role.mentionable !== false,
        mentionable: false,
      };
    });
  views.push(
    ...mentionTierViews(sets.tiers ?? [], roles, holders),
    ...mentionGroupViews(sets.groups ?? [], sets.memberships ?? []),
  );
  if (roles.length === 0) return views;
  const everyone = roles.find(isEveryoneRole);
  views.push({
    role_id: everyone?.id ?? HERE_MENTION_NAME,
    kind: 'role',
    name: HERE_MENTION_NAME,
    color: null,
    member_ids: [],
    open_to_all: everyone ? everyone.mentionable !== false : false,
    mentionable: false,
  });
  return views;
}

/** The chapter's tiers and groups, with who is in each group (#4076). */
export interface MentionSets {
  tiers: readonly RoleTier[];
  groups: readonly ChapterGroup[];
  memberships: readonly ChapterGroupMembership[];
}

/** A tier or group whose name reads as `@everyone` or `@here` is no target. */
function nameIsFree(name: string): boolean {
  return reservedMentionName(name) === null;
}

/**
 * Each tier as a mention (#4076, Paul 2026-11-11: "that tier name is
 * pingable"): it reaches every member holding a role in it, the hidden
 * Everyone role included (its holders are the tier's members as much as
 * anyone's), so a member whose role leaves the tier stops getting it. In tier
 * order, highest first, with the tier's own switch.
 *
 * A tier holding the Everyone role reaches nearly the whole chapter, so it is
 * `@everyone` under another name: it also follows the Everyone role's switch
 * (#4191, officers only by default), or `@Members` would let any member ping
 * everyone past the rule `@everyone` keeps.
 */
function mentionTierViews(
  tiers: readonly RoleTier[],
  roles: readonly Role[],
  holders: ReadonlyMap<string, readonly string[]>,
): MentionRoleView[] {
  return [...tiers]
    .filter((tier) => nameIsFree(tier.name))
    .sort((a, b) => a.position - b.position)
    .map((tier) => {
      const inTier = roles.filter((role) => role.tier_id === tier.id);
      const everyone = inTier.find(isEveryoneRole);
      return {
        role_id: tier.id,
        kind: 'tier' as const,
        name: tier.name,
        color: null,
        member_ids: [
          ...new Set(inTier.flatMap((role) => holders.get(role.id) ?? [])),
        ],
        open_to_all:
          tier.mentionable !== false &&
          (!everyone || everyone.mentionable !== false),
        mentionable: false,
      };
    });
}

/**
 * Each group as a mention (#4076): it reaches the group's members now, as
 * `chapter_group_memberships` reads them, with the group's own switch.
 * Manual groups first, then pledge classes and class years.
 */
function mentionGroupViews(
  groups: readonly ChapterGroup[],
  memberships: readonly ChapterGroupMembership[],
): MentionRoleView[] {
  return (
    withMembers(
      groups.filter((group) => nameIsFree(group.name)),
      memberships,
    )
      // An automatic group nobody is in (a class not yet given members) is
      // left out, as the Groups page leaves it out.
      .filter((group) => group.kind === 'manual' || group.member_ids.length > 0)
      .map((group) => ({
        role_id: group.id,
        kind: 'group' as const,
        name: group.name,
        color: group.color,
        member_ids: group.member_ids,
        open_to_all: group.mentionable !== false,
        mentionable: false,
      }))
  );
}

function withMentionable(
  view: MentionRoleView,
  officer: boolean,
): MentionRoleView {
  return { ...view, mentionable: officer || view.open_to_all };
}
