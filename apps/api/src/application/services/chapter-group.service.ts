import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  foldMentionName,
  GROUP_MEMBERS_MAX,
  GROUPS_MAX,
  reservedMentionName,
} from '@repo/validation';
import { CHAPTER_GROUP_REPOSITORY } from '#domain/repositories/chapter-group.repository.interface';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import type {
  ChapterGroup,
  ChapterGroupMembership,
} from '#domain/entities/chapter-group.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import { RbacService } from './rbac.service';

/**
 * The channel rule for a group's members, one copy for every write that
 * changes who is in a group: when a channel or category list names any of
 * `groupIds`, the change needs `channels:manage` (see
 * {@link ChapterGroupService}). `PledgeClassService` keeps it for a class's
 * group, which follows its members' class; `refusal` names which kind of set
 * it is.
 */
export async function assertMayChangeGroupAccess(
  groupRepo: Pick<IChapterGroupRepository, 'isNamedOnChannelList'>,
  rbac: Pick<RbacService, 'memberHasAnyPermission'>,
  args: {
    chapterId: string;
    actorUserId: string;
    groupIds: readonly string[];
    refusal: string;
  },
): Promise<void> {
  const { chapterId, actorUserId, groupIds, refusal } = args;
  const named = await Promise.all(
    groupIds.map((id) => groupRepo.isNamedOnChannelList(chapterId, id)),
  );
  if (!named.some(Boolean)) return;
  const may = await rbac.memberHasAnyPermission(chapterId, actorUserId, [
    SystemPermissions.CHANNELS_MANAGE,
  ]);
  if (!may) throw new ForbiddenException(refusal);
}

/** `target_type` of a group's audit rows. */
const AUDIT_TARGET_TYPE = 'chapter_group';

/** A group with who is in it now. */
export type ChapterGroupView = ChapterGroup & { member_ids: string[] };

/**
 * A chapter's groups (#4076): named sets of members with no permissions,
 * which can be `@`-mentioned and named in a channel's who-can-see and
 * who-can-post lists.
 *
 * Reads need `members:view` and writes `groups:manage` (the controller).
 * There is no rank rule here, unlike roles and tiers: a group grants no
 * permission, so putting someone in one can't lift what they can do. What it
 * can do is let them see a channel listing it, so once a channel or category
 * list names a group, changing its members or deleting it also needs
 * `channels:manage` ({@link ChapterGroupService.assertMayChangeAccess}). A
 * class year or a major can't go on a list at all (members set their own).
 *
 * Only a manual group's name and members are written here. An automatic
 * group (a pledge class's, a graduation year's, a major's) follows the
 * members' data, which the database keeps (`20261113040007_chapter_groups.sql`,
 * `20261120215726_major_groups.sql`); its color
 * and ping switch are the chapter's.
 *
 * Every change writes a `chapter_audit_log` row mirrored to `#chapter-audit`,
 * as a role change does.
 */
@Injectable()
export class ChapterGroupService {
  constructor(
    @Inject(CHAPTER_GROUP_REPOSITORY)
    private readonly groupRepo: IChapterGroupRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(ROLE_TIER_REPOSITORY)
    private readonly tierRepo: IRoleTierRepository,
    private readonly audit: ChapterAuditLogService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Every group with its members: manual ones first, in the order they were
   * made, then pledge classes, class years and majors. An automatic group
   * nobody is in is left out (a class with no members yet, a year everyone
   * left, a major nobody has any more).
   */
  async list(chapterId: string): Promise<ChapterGroupView[]> {
    const [groups, memberships] = await Promise.all([
      this.groupRepo.findByChapter(chapterId),
      this.groupRepo.findMemberships(chapterId),
    ]);
    return withMembers(groups, memberships).filter(
      (group) => group.kind === 'manual' || group.member_ids.length > 0,
    );
  }

  async create(
    chapterId: string,
    actorUserId: string,
    data: {
      name: string;
      color?: string | null;
      mentionable?: boolean;
      member_ids?: string[];
    },
  ): Promise<ChapterGroupView> {
    const name = data.name.trim();
    const groups = await this.groupRepo.findByChapter(chapterId);
    if (groups.filter((g) => g.kind === 'manual').length >= GROUPS_MAX) {
      throw new BadRequestException(
        `A chapter can have at most ${GROUPS_MAX} groups`,
      );
    }
    await this.assertNameFree(chapterId, name, groups, null);

    const group = await this.groupRepo.create({
      chapter_id: chapterId,
      name,
      color: data.color ?? null,
      mentionable: data.mentionable ?? true,
    });
    if (!group) throw new ConflictException(NAME_TAKEN);

    let memberIds: string[] = [];
    if (data.member_ids?.length) {
      const set = await this.groupRepo.setMembers(
        group.id,
        chapterId,
        data.member_ids,
      );
      if (set === 'member_not_found') {
        // The group stands without them: say so rather than leave a group
        // the officer didn't mean to make empty.
        await this.groupRepo.delete(group.id, chapterId);
        throw new BadRequestException(NOT_A_MEMBER);
      }
      if (set === 'group_not_found') throw new NotFoundException(NOT_FOUND);
      memberIds = set;
    }

    await this.audit.record({
      chapterId,
      actorUserId,
      action: 'chapter_group_created',
      targetType: AUDIT_TARGET_TYPE,
      targetId: group.id,
      diff: {
        group: {
          from: null,
          to: { name: group.name, color: group.color },
        },
        ...(memberIds.length > 0
          ? { members: { from: [], to: memberIds } }
          : {}),
      },
    });
    return { ...group, member_ids: memberIds };
  }

  /**
   * Rename, recolor or switch pinging. Only a manual group may be renamed; an
   * automatic one's name is its class's, year's or major's.
   */
  async update(
    id: string,
    chapterId: string,
    actorUserId: string,
    data: { name?: string; color?: string | null; mentionable?: boolean },
  ): Promise<ChapterGroupView> {
    const groups = await this.groupRepo.findByChapter(chapterId);
    const group = groups.find((candidate) => candidate.id === id);
    if (!group) throw new NotFoundException(NOT_FOUND);

    const changes: {
      name?: string;
      color?: string | null;
      mentionable?: boolean;
    } = {};
    if (data.name !== undefined) {
      const name = data.name.trim();
      if (group.kind !== 'manual') {
        if (name !== group.name) {
          throw new BadRequestException(
            "This group's name follows its pledge class, graduation year or major",
          );
        }
      } else if (name !== group.name) {
        await this.assertNameFree(chapterId, name, groups, group.id);
        changes.name = name;
      }
    }
    if (data.color !== undefined && data.color !== group.color) {
      changes.color = data.color;
    }
    if (
      data.mentionable !== undefined &&
      data.mentionable !== group.mentionable
    ) {
      changes.mentionable = data.mentionable;
    }

    let updated = group;
    if (Object.keys(changes).length > 0) {
      const saved = await this.groupRepo.update(id, chapterId, changes);
      if (saved === null) throw new ConflictException(NAME_TAKEN);
      if (saved === undefined) throw new NotFoundException(NOT_FOUND);
      updated = saved;
      await this.audit.record({
        chapterId,
        actorUserId,
        action: 'chapter_group_updated',
        targetType: AUDIT_TARGET_TYPE,
        targetId: id,
        diff: Object.fromEntries(
          Object.keys(changes).map((field) => [
            field,
            {
              from: group[field as keyof typeof changes],
              to: updated[field as keyof typeof changes],
            },
          ]),
        ),
      });
    }
    return { ...updated, member_ids: await this.memberIdsOf(chapterId, id) };
  }

  /** A manual group's whole member list, replaced all or none. */
  async setMembers(
    id: string,
    chapterId: string,
    actorUserId: string,
    memberIds: string[],
  ): Promise<ChapterGroupView> {
    const group = await this.manualGroup(id, chapterId);
    await this.assertMayChangeAccess(chapterId, actorUserId, id);

    const before = await this.memberIdsOf(chapterId, id);
    const after = await this.groupRepo.setMembers(id, chapterId, memberIds);
    if (after === 'group_not_found') throw new NotFoundException(NOT_FOUND);
    if (after === 'member_not_found') {
      throw new BadRequestException(NOT_A_MEMBER);
    }

    const added = after.filter((userId) => !before.includes(userId));
    const removed = before.filter((userId) => !after.includes(userId));
    if (added.length > 0 || removed.length > 0) {
      await this.recordMembers(chapterId, actorUserId, id, before, after);
    }
    return { ...group, member_ids: after };
  }

  /**
   * Put one member in a manual group, or take them out, from their profile
   * (Paul, 2026-11-19: groups set where the person is, not only from the
   * group's editor). The same gates as a whole-list save: `groups:manage`
   * (the controller), and `channels:manage` too when a channel list names
   * the group. A change that changes nothing (already in, already out) is
   * no write and no audit row. Answers the group with who is in it after.
   */
  async addMember(
    id: string,
    chapterId: string,
    actorUserId: string,
    userId: string,
  ): Promise<ChapterGroupView> {
    const group = await this.manualGroup(id, chapterId);
    await this.assertMayChangeAccess(chapterId, actorUserId, id);
    const before = await this.memberIdsOf(chapterId, id);
    if (!before.includes(userId) && before.length >= GROUP_MEMBERS_MAX) {
      throw new BadRequestException(GROUP_FULL);
    }
    const result = await this.groupRepo.addMember(id, chapterId, userId);
    if (result === 'group_not_found') throw new NotFoundException(NOT_FOUND);
    if (result === 'member_not_found') {
      throw new BadRequestException(NOT_A_MEMBER);
    }
    // One row in or out, so the list after is the one before with it: no
    // second read of a list that can hold thousands.
    if (result !== 'added') return { ...group, member_ids: before };
    const after = [...before, userId];
    await this.recordMembers(chapterId, actorUserId, id, before, after);
    return { ...group, member_ids: after };
  }

  /** See {@link ChapterGroupService.addMember}. */
  async removeMember(
    id: string,
    chapterId: string,
    actorUserId: string,
    userId: string,
  ): Promise<ChapterGroupView> {
    const group = await this.manualGroup(id, chapterId);
    await this.assertMayChangeAccess(chapterId, actorUserId, id);
    const before = await this.memberIdsOf(chapterId, id);
    const removed = await this.groupRepo.removeMember(id, chapterId, userId);
    if (!removed) return { ...group, member_ids: before };
    const after = before.filter((memberId) => memberId !== userId);
    await this.recordMembers(chapterId, actorUserId, id, before, after);
    return { ...group, member_ids: after };
  }

  private async manualGroup(id: string, chapterId: string) {
    const group = await this.groupRepo.findById(id, chapterId);
    if (!group) throw new NotFoundException(NOT_FOUND);
    if (group.kind !== 'manual') throw new BadRequestException(AUTOMATIC);
    return group;
  }

  /** The same audit row a whole-list save writes, so the feed reads alike. */
  private recordMembers(
    chapterId: string,
    actorUserId: string,
    groupId: string,
    before: string[],
    after: string[],
  ) {
    return this.audit.record({
      chapterId,
      actorUserId,
      action: 'chapter_group_members_set',
      targetType: AUDIT_TARGET_TYPE,
      targetId: groupId,
      diff: { members: { from: before, to: after } },
    });
  }

  /**
   * Delete a manual group. Every channel list naming it loses the entry (a
   * trigger), so a channel only it could see falls to the chapter's top tier
   * (migration `20261120051720`) until an officer
   * picks again, as when a role is deleted.
   */
  async remove(id: string, chapterId: string, actorUserId: string) {
    const group = await this.groupRepo.findById(id, chapterId);
    if (!group) throw new NotFoundException(NOT_FOUND);
    if (group.kind !== 'manual') throw new BadRequestException(AUTOMATIC);
    await this.assertMayChangeAccess(chapterId, actorUserId, id);
    await this.groupRepo.delete(id, chapterId);
    await this.audit.record({
      chapterId,
      actorUserId,
      action: 'chapter_group_deleted',
      targetType: AUDIT_TARGET_TYPE,
      targetId: id,
      diff: { group: { from: { name: group.name }, to: null } },
    });
  }

  private async memberIdsOf(chapterId: string, groupId: string) {
    return [...(await this.groupRepo.findMemberIds(chapterId, groupId))].sort();
  }

  /**
   * A group a channel or category list names decides who reads and posts
   * there, so changing who is in it, or deleting it, is a change to that
   * channel's access: it needs `channels:manage`, as editing the list itself
   * does. Without this a `groups:manage` holder (a house manager) could add
   * themselves to "Exec" and read the exec channel. A group no list names
   * grants nothing, so `groups:manage` alone is enough for it.
   */
  private assertMayChangeAccess(
    chapterId: string,
    actorUserId: string,
    groupId: string,
  ): Promise<void> {
    return assertMayChangeGroupAccess(this.groupRepo, this.rbac, {
      chapterId,
      actorUserId,
      groupIds: [groupId],
      refusal: GATES_A_CHANNEL,
    });
  }

  /**
   * A group's name is what `@` mentions it by, so it must name one thing:
   * not `@everyone` or `@here`, and not a role, tier or other group of the
   * chapter, compared as a mention compares (case and punctuation ignored).
   * The resolver would still reach every same-named set together, but an
   * officer making "Officers" beside a role "Officers" means a new thing,
   * and should pick a name that says so.
   */
  private async assertNameFree(
    chapterId: string,
    name: string,
    groups: readonly ChapterGroup[],
    selfId: string | null,
  ): Promise<void> {
    if (reservedMentionName(name) !== null) {
      throw new BadRequestException(
        `"${name}" is how everyone or who's online is mentioned. Pick another name.`,
      );
    }
    const folded = foldMentionName(name);
    if (folded.length === 0) {
      throw new BadRequestException('A group name needs a letter or a number');
    }
    const [roles, tiers] = await Promise.all([
      this.roleRepo.findByChapter(chapterId),
      this.tierRepo.findByChapter(chapterId),
    ]);
    const names = [
      ...roles.filter((r) => r.chapter_id === chapterId).map((r) => r.name),
      ...tiers.filter((t) => t.chapter_id === chapterId).map((t) => t.name),
      // Not a major's group (#5778): members type their own major, so one
      // must not lock an officer out of a name (the row of a major nobody has
      // any more is hidden and can't be deleted). A major gives way instead:
      // one named like another set isn't a mention target
      // (`namesAutomaticGroupsGiveWayTo` in chat-mention.service.ts).
      ...groups
        .filter((g) => g.id !== selfId && g.kind !== 'major')
        .map((g) => g.name),
    ];
    if (names.some((other) => foldMentionName(other) === folded)) {
      throw new ConflictException(NAME_TAKEN);
    }
  }
}

const NOT_FOUND = 'Group not found';
const GATES_A_CHANNEL =
  'A channel uses this group to decide who can see or post in it, so only someone who can manage channels can change who is in it.';
const NAME_TAKEN =
  'A role, tier or group already has that name. Pick another so @mentions reach the right people.';
const NOT_A_MEMBER =
  'Someone you picked is no longer in the chapter. Reload and pick again.';
const GROUP_FULL = `A group can hold ${GROUP_MEMBERS_MAX.toLocaleString('en-US')} members.`;
const AUTOMATIC =
  "This group follows pledge classes, graduation years or majors, so who's in it changes with them.";

/** Each group with the `users.id` of every member in it, sorted. */
export function withMembers(
  groups: readonly ChapterGroup[],
  memberships: readonly ChapterGroupMembership[],
): ChapterGroupView[] {
  const members = new Map<string, Set<string>>();
  for (const { group_id, user_id } of memberships) {
    const set = members.get(group_id) ?? new Set<string>();
    set.add(user_id);
    members.set(group_id, set);
  }
  const order: Record<ChapterGroup['kind'], number> = {
    manual: 0,
    pledge_class: 1,
    class_year: 2,
    major: 3,
  };
  return [...groups]
    .sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        (a.kind === 'class_year'
          ? (a.class_year ?? 0) - (b.class_year ?? 0)
          : a.kind === 'major'
            ? a.name.localeCompare(b.name)
            : a.created_at.localeCompare(b.created_at)),
    )
    .map((group) => ({
      ...group,
      member_ids: [...(members.get(group.id) ?? [])].sort(),
    }));
}
