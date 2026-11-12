import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  foldMentionName,
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
import { ChapterAuditLogService } from './chapter-audit-log.service';

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
 * There is no rank rule here, unlike roles and tiers: a group grants nothing,
 * so putting someone in one can't lift what they can do. What it can do is
 * let them see a channel listing it, which is the channel's officers' call,
 * made when they list the group.
 *
 * Only a manual group's name and members are written here. An automatic
 * group (a pledge class's, a graduation year's) follows the members' data,
 * which the database keeps (`20261113040002_chapter_groups.sql`); its color
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
  ) {}

  /**
   * Every group with its members: manual ones first, in the order they were
   * made, then pledge classes and class years. An automatic group nobody is
   * in is left out (a class with no members yet, a year everyone left).
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
   * automatic one's name is its class's or year's.
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
            "This group's name follows its pledge class or graduation year",
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
    const group = await this.groupRepo.findById(id, chapterId);
    if (!group) throw new NotFoundException(NOT_FOUND);
    if (group.kind !== 'manual') throw new BadRequestException(AUTOMATIC);

    const before = await this.memberIdsOf(chapterId, id);
    const after = await this.groupRepo.setMembers(id, chapterId, memberIds);
    if (after === 'group_not_found') throw new NotFoundException(NOT_FOUND);
    if (after === 'member_not_found') {
      throw new BadRequestException(NOT_A_MEMBER);
    }

    const added = after.filter((userId) => !before.includes(userId));
    const removed = before.filter((userId) => !after.includes(userId));
    if (added.length > 0 || removed.length > 0) {
      await this.audit.record({
        chapterId,
        actorUserId,
        action: 'chapter_group_members_set',
        targetType: AUDIT_TARGET_TYPE,
        targetId: id,
        diff: { members: { from: before, to: after } },
      });
    }
    return { ...group, member_ids: after };
  }

  /**
   * Delete a manual group. Every channel list naming it loses the entry (a
   * trigger), so a channel only it could see is left to `*` until an officer
   * picks again, as when a role is deleted.
   */
  async remove(id: string, chapterId: string, actorUserId: string) {
    const group = await this.groupRepo.findById(id, chapterId);
    if (!group) throw new NotFoundException(NOT_FOUND);
    if (group.kind !== 'manual') throw new BadRequestException(AUTOMATIC);
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
    const memberships = await this.groupRepo.findMemberships(chapterId);
    return memberships
      .filter((row) => row.group_id === groupId)
      .map((row) => row.user_id)
      .sort();
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
      ...groups.filter((g) => g.id !== selfId).map((g) => g.name),
    ];
    if (names.some((other) => foldMentionName(other) === folded)) {
      throw new ConflictException(NAME_TAKEN);
    }
  }
}

const NOT_FOUND = 'Group not found';
const NAME_TAKEN =
  'A role, tier or group already has that name. Pick another so @mentions reach the right people.';
const NOT_A_MEMBER =
  'Someone you picked is no longer in the chapter. Reload and pick again.';
const AUTOMATIC =
  "This group follows pledge classes or graduation years, so who's in it changes with them.";

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
  };
  return [...groups]
    .sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        (a.kind === 'class_year'
          ? (a.class_year ?? 0) - (b.class_year ?? 0)
          : a.created_at.localeCompare(b.created_at)),
    )
    .map((group) => ({
      ...group,
      member_ids: [...(members.get(group.id) ?? [])].sort(),
    }));
}
