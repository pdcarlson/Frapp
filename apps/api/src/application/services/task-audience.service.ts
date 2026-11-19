import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  TASK_AUDIENCE_COPY,
  TASK_FOLLOWER_COPY,
  TASK_PEOPLE_MAX,
  parseTaskFollower,
  taskFollowerEntry,
  type TaskFollowerKind,
} from '@repo/validation';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { CHAPTER_GROUP_REPOSITORY } from '#domain/repositories/chapter-group.repository.interface';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import {
  SystemPermissions,
  SystemRoleKeys,
} from '#domain/constants/permissions';
import {
  groupKindOpensChannels,
  type ChapterGroup,
} from '#domain/entities/chapter-group.entity';
import type { Role, RoleTier } from '#domain/entities/role.entity';

import { RbacService } from './rbac.service';

/**
 * Who a task goes to, or who may claim one up for grabs (Paul, 2026-11-18):
 * the chapter, a role's holders, a chapter group's members (manual or
 * automatic: a pledge class's, a class year's), everyone holding a role in a
 * tier (#5473), or people picked one by one.
 */
export type TaskAudienceTarget =
  | { kind: 'chapter' }
  | { kind: 'role'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'tier'; id: string }
  | { kind: 'people'; userIds: string[] };

/** A target as checked for a new task: who it reaches now, and its name. */
export interface ResolvedTaskAudience {
  /** The chapter's Everyone role reads as the chapter itself. */
  kind: TaskAudienceTarget['kind'];
  /** The role, group or tier, for `role`, `group` and `tier`. */
  targetId: string | null;
  /** Its name now, kept on the row for once it's deleted. */
  targetName: string | null;
  /** The members it reaches: active, alumni left out, each once. */
  userIds: string[];
}

/**
 * One chapter's members read once, for checking several targets in a row:
 * the board's list of postings, or a claim. Roles and groups are read when a
 * target first needs them, a group's members once per group.
 */
export class TaskAudienceReader {
  private roles: Promise<Role[]> | null = null;
  private groups: Promise<ChapterGroup[]> | null = null;
  private tiers: Promise<RoleTier[]> | null = null;
  private readonly groupMembers = new Map<string, Promise<string[]>>();

  constructor(
    private readonly chapterId: string,
    /** Active members' user ids, alumni left out. */
    readonly activeIds: ReadonlySet<string>,
    /** Every member's roles, by user id, alumni included. */
    private readonly roleIdsByUser: ReadonlyMap<string, readonly string[]>,
    private readonly repos: {
      roleRepo: IRoleRepository;
      groupRepo: IChapterGroupRepository;
      tierRepo: IRoleTierRepository;
    },
  ) {}

  private tier(id: string): Promise<RoleTier | undefined> {
    this.tiers ??= this.repos.tierRepo.findByChapter(this.chapterId);
    return this.tiers.then((tiers) => tiers.find((tier) => tier.id === id));
  }

  /**
   * Who holds a role in a tier now: active members only. A tier holding the
   * chapter's Everyone role reaches the chapter; its Alumni role reaches
   * nobody, as alumni get no chapter tasks.
   */
  private async holdersOfTier(tierId: string): Promise<string[]> {
    this.roles ??= this.repos.roleRepo.findByChapter(this.chapterId);
    const roles = (await this.roles).filter(
      (role) =>
        role.tier_id === tierId && role.system_key !== SystemRoleKeys.ALUMNI,
    );
    if (roles.some((role) => role.system_key === SystemRoleKeys.MEMBER)) {
      return [...this.activeIds];
    }
    const roleIds = new Set(roles.map((role) => role.id));
    return [...this.activeIds].filter((userId) =>
      (this.roleIdsByUser.get(userId) ?? []).some((id) => roleIds.has(id)),
    );
  }

  private role(id: string): Promise<Role | undefined> {
    this.roles ??= this.repos.roleRepo.findByChapter(this.chapterId);
    return this.roles.then((roles) => roles.find((role) => role.id === id));
  }

  private group(id: string): Promise<ChapterGroup | undefined> {
    this.groups ??= this.repos.groupRepo.findByChapter(this.chapterId);
    return this.groups.then((groups) =>
      groups.find((group) => group.id === id),
    );
  }

  private membersOfGroup(id: string): Promise<string[]> {
    let members = this.groupMembers.get(id);
    if (!members) {
      members = this.repos.groupRepo.findMemberIds(this.chapterId, id);
      this.groupMembers.set(id, members);
    }
    return members;
  }

  private holdersOf(roleId: string): string[] {
    return [...this.activeIds].filter((userId) =>
      (this.roleIdsByUser.get(userId) ?? []).includes(roleId),
    );
  }

  /** The current name of a role, group or tier of the chapter, or null once gone. */
  async nameOf(
    kind: 'role' | 'group' | 'tier',
    id: string,
  ): Promise<string | null> {
    const found =
      kind === 'role'
        ? await this.role(id)
        : kind === 'group'
          ? await this.group(id)
          : await this.tier(id);
    return found?.name ?? null;
  }

  /**
   * Who a target reaches now, never throwing: a role or group since deleted
   * reaches nobody, and listed people who left or became alumni drop out.
   * The chapter's Everyone role reaches the chapter.
   */
  async eligible(target: TaskAudienceTarget): Promise<string[]> {
    switch (target.kind) {
      case 'chapter':
        return [...this.activeIds];
      case 'role': {
        const role = await this.role(target.id);
        if (!role || role.system_key === SystemRoleKeys.ALUMNI) return [];
        return role.system_key === SystemRoleKeys.MEMBER
          ? [...this.activeIds]
          : this.holdersOf(role.id);
      }
      case 'group': {
        if (!(await this.group(target.id))) return [];
        const ids = await this.membersOfGroup(target.id);
        return [...new Set(ids)].filter((id) => this.activeIds.has(id));
      }
      case 'tier':
        return (await this.tier(target.id))
          ? this.holdersOfTier(target.id)
          : [];
      case 'people':
        return [...new Set(target.userIds)].filter((id) =>
          this.activeIds.has(id),
        );
    }
  }

  /**
   * A target for a new task, checked: the role or group must be the
   * chapter's (and the role not Alumni), every listed person an active
   * member, and the target must reach someone. 400 otherwise.
   */
  async resolve(target: TaskAudienceTarget): Promise<ResolvedTaskAudience> {
    switch (target.kind) {
      case 'chapter':
        return this.reaching(
          { kind: 'chapter', targetId: null, targetName: null },
          [...this.activeIds],
          TASK_AUDIENCE_COPY.nobodyInChapter,
        );
      case 'role': {
        const role = await this.role(target.id);
        if (!role) {
          throw new BadRequestException("That role isn't in this chapter");
        }
        if (role.system_key === SystemRoleKeys.ALUMNI) {
          throw new BadRequestException(
            "Alumni don't get chapter tasks, so a task can't go to that role",
          );
        }
        if (role.system_key === SystemRoleKeys.MEMBER) {
          return this.resolve({ kind: 'chapter' });
        }
        return this.reaching(
          { kind: 'role', targetId: role.id, targetName: role.name },
          this.holdersOf(role.id),
          TASK_AUDIENCE_COPY.nobodyInRole,
        );
      }
      case 'group': {
        const group = await this.group(target.id);
        if (!group) {
          throw new BadRequestException("That group isn't in this chapter");
        }
        return this.reaching(
          { kind: 'group', targetId: group.id, targetName: group.name },
          await this.eligible(target),
          TASK_AUDIENCE_COPY.nobodyInGroup,
        );
      }
      case 'tier': {
        const tier = await this.tier(target.id);
        if (!tier) {
          throw new BadRequestException("That tier isn't in this chapter");
        }
        return this.reaching(
          { kind: 'tier', targetId: tier.id, targetName: tier.name },
          await this.holdersOfTier(tier.id),
          TASK_AUDIENCE_COPY.nobodyInTier,
        );
      }
      case 'people': {
        const userIds = [...new Set(target.userIds)];
        if (userIds.length > TASK_PEOPLE_MAX) {
          throw new BadRequestException(`Pick up to ${TASK_PEOPLE_MAX} people`);
        }
        if (userIds.some((id) => !this.activeIds.has(id))) {
          throw new BadRequestException(
            'Everyone you pick must be an active member of the chapter',
          );
        }
        return this.reaching(
          { kind: 'people', targetId: null, targetName: null },
          userIds,
          'Pick who this task is for',
        );
      }
    }
  }

  private reaching(
    found: Omit<ResolvedTaskAudience, 'userIds'>,
    userIds: string[],
    nobody: string,
  ): ResolvedTaskAudience {
    if (userIds.length === 0) throw new BadRequestException(nobody);
    return { ...found, userIds };
  }
}

/**
 * Reads who a task's audience reaches (Paul, 2026-11-18): the members a
 * group task copies to, and who may claim a task up for grabs. Alumni are
 * always left out (`spec/behavior/alumni.md`), as they were from Everyone.
 * Tasks grant no permission, so there is no rank rule: any `tasks:manage`
 * holder may give one to any role or group.
 */
@Injectable()
export class TaskAudienceService {
  constructor(
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(CHAPTER_GROUP_REPOSITORY)
    private readonly groupRepo: IChapterGroupRepository,
    @Inject(ROLE_TIER_REPOSITORY)
    private readonly tierRepo: IRoleTierRepository,
    private readonly rbac: RbacService,
  ) {}

  /** A reader over the chapter's members as they stand now. */
  async reader(chapterId: string): Promise<TaskAudienceReader> {
    const [members, alumniRoleId] = await Promise.all([
      this.memberRepo.findByChapter(chapterId),
      this.rbac.getAlumniRoleId(chapterId),
    ]);
    const roleIdsByUser = new Map<string, string[]>();
    const activeIds = new Set<string>();
    for (const member of members) {
      const roleIds = member.role_ids ?? [];
      roleIdsByUser.set(member.user_id, roleIds);
      if (!alumniRoleId || !roleIds.includes(alumniRoleId)) {
        activeIds.add(member.user_id);
      }
    }
    return new TaskAudienceReader(chapterId, activeIds, roleIdsByUser, {
      roleRepo: this.roleRepo,
      groupRepo: this.groupRepo,
      tierRepo: this.tierRepo,
    });
  }

  /**
   * The current names of these roles and groups of the chapter, by id; one
   * since deleted is absent. Read only for the kinds asked about.
   */
  async liveNames(
    chapterId: string,
    ids: { roleIds: string[]; groupIds: string[]; tierIds?: string[] },
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const tierIds = ids.tierIds ?? [];
    const [roles, groups, tiers] = await Promise.all([
      ids.roleIds.length > 0
        ? this.roleRepo.findByIds(ids.roleIds, chapterId)
        : [],
      ids.groupIds.length > 0 ? this.groupRepo.findByChapter(chapterId) : [],
      tierIds.length > 0 ? this.tierRepo.findByChapter(chapterId) : [],
    ]);
    for (const role of roles) names.set(role.id, role.name);
    const wanted = new Set([...ids.groupIds, ...tierIds]);
    for (const row of [...groups, ...tiers]) {
      if (wanted.has(row.id)) names.set(row.id, row.name);
    }
    return names;
  }

  /**
   * The follower entries a member is in now (#5473): `role:` for each role
   * they hold, `tier:` for its tier, `group:` for each group they are in that
   * can open a channel, as {@link RbacService.getChannelAccessHolder} reads
   * them for chat, so "who follows" and "who sees a channel" can't drift.
   * None for an alumnus or a non-member: alumni get no chapter tasks.
   */
  async followEntriesOf(chapterId: string, userId: string): Promise<string[]> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) return [];
    const holder = await this.rbac.getChannelAccessHolder(
      chapterId,
      member,
      true,
    );
    if (holder.alumniEntries) return [];
    return [...holder.entries];
  }

  /**
   * The active members of the tier, role or group a task names in
   * `followed_by` (#5473), read now; nobody for one since deleted or an
   * entry that doesn't parse. Worked out as {@link followEntriesOf} grants
   * entries (the roles in each member's `role_ids`, their tiers, the groups
   * that open a channel; nobody holding the Alumni role), so whoever hears
   * about a followed task can open it.
   */
  async followerIds(chapterId: string, entry: string): Promise<string[]> {
    const parsed = parseTaskFollower(entry);
    if (!parsed) return [];
    if (parsed.kind === 'group') {
      const group = await this.groupRepo.findById(parsed.id, chapterId);
      if (!group || !groupKindOpensChannels(group.kind)) return [];
      const [reader, ids] = await Promise.all([
        this.reader(chapterId),
        this.groupRepo.findMemberIds(chapterId, parsed.id),
      ]);
      return [...new Set(ids)].filter((id) => reader.activeIds.has(id));
    }
    const [members, alumniRoleId, roles] = await Promise.all([
      this.memberRepo.findByChapter(chapterId),
      this.rbac.getAlumniRoleId(chapterId),
      this.roleRepo.findByChapter(chapterId),
    ]);
    const roleIds = new Set(
      roles
        .filter((role) =>
          parsed.kind === 'role'
            ? role.id === parsed.id
            : role.tier_id === parsed.id,
        )
        .map((role) => role.id.toLowerCase()),
    );
    const alumni = alumniRoleId?.toLowerCase() ?? null;
    const ids = new Set<string>();
    for (const member of members) {
      if (member.chapter_id && member.chapter_id !== chapterId) continue;
      const held = (member.role_ids ?? []).map((id) => id.toLowerCase());
      if (alumni && held.includes(alumni)) continue;
      if (held.some((id) => roleIds.has(id))) ids.add(member.user_id);
    }
    return [...ids];
  }

  /**
   * A follower for a new or edited task, checked (#5473): an entry naming a
   * tier, role or group of the chapter that `userId` is in, so "From Exec
   * board" is true when an officer sets it. Not the Everyone or Alumni role
   * (the chapter, or nobody), nor a class year, which opens no channel
   * either. Returns the entry as stored; 400 otherwise.
   */
  async checkedFollower(
    chapterId: string,
    userId: string,
    entry: string,
  ): Promise<string> {
    const parsed = parseTaskFollower(entry.toLowerCase());
    if (!parsed) {
      throw new BadRequestException(
        'followed_by is a tier, role or group: "tier:<id>", "role:<id>" or "group:<id>"',
      );
    }
    const stored = taskFollowerEntry(parsed.kind, parsed.id);
    const exists = await this.followerExists(chapterId, parsed.kind, parsed.id);
    if (!exists) {
      // Gone, another chapter's, or one that means the whole chapter (the
      // Everyone role, its tier) or opens nothing (a class year).
      throw new BadRequestException(
        `That ${parsed.kind} can't be what a task is from. Pick one of this chapter's tiers, roles or groups.`,
      );
    }
    if (!(await this.followEntriesOf(chapterId, userId)).includes(stored)) {
      throw new BadRequestException(TASK_FOLLOWER_COPY.notIn);
    }
    return stored;
  }

  private async followerExists(
    chapterId: string,
    kind: TaskFollowerKind,
    id: string,
  ): Promise<boolean> {
    switch (kind) {
      case 'role': {
        const [role] = await this.roleRepo.findByIds([id], chapterId);
        return (
          !!role &&
          role.chapter_id === chapterId &&
          role.system_key !== SystemRoleKeys.MEMBER &&
          role.system_key !== SystemRoleKeys.ALUMNI
        );
      }
      case 'group': {
        const group = await this.groupRepo.findById(id, chapterId);
        return !!group && groupKindOpensChannels(group.kind);
      }
      case 'tier': {
        // Not the tier holding the Everyone role: that would be the
        // chapter, as the Everyone role is.
        const [tiers, roles] = await Promise.all([
          this.tierRepo.findByChapter(chapterId),
          this.roleRepo.findByChapter(chapterId),
        ]);
        return (
          tiers.some((tier) => tier.id === id) &&
          !roles.some(
            (role) =>
              role.tier_id === id && role.system_key === SystemRoleKeys.MEMBER,
          )
        );
      }
    }
  }

  /**
   * Which of `userIds` can confirm tasks (`tasks:manage`): a follower who can
   * gets the review push, the rest the informational one (#5473).
   */
  async canConfirm(
    chapterId: string,
    userIds: readonly string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const managers = await this.rbac.findUserIdsWithPermissions(chapterId, [
      SystemPermissions.TASKS_MANAGE,
    ]);
    const wanted = new Set(userIds);
    return new Set(managers.filter((id) => wanted.has(id)));
  }
}
