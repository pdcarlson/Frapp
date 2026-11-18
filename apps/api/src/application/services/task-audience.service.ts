import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TASK_AUDIENCE_COPY, TASK_PEOPLE_MAX } from '@repo/validation';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { CHAPTER_GROUP_REPOSITORY } from '#domain/repositories/chapter-group.repository.interface';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import { SystemRoleKeys } from '#domain/constants/permissions';
import type { Role } from '#domain/entities/role.entity';
import type { ChapterGroup } from '#domain/entities/chapter-group.entity';
import { RbacService } from './rbac.service';

/**
 * Who a task goes to, or who may claim one up for grabs (Paul, 2026-11-18):
 * the chapter, a role's holders, a chapter group's members (manual or
 * automatic: a pledge class's, a class year's), or people picked one by one.
 */
export type TaskAudienceTarget =
  | { kind: 'chapter' }
  | { kind: 'role'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'people'; userIds: string[] };

/** A target as checked for a new task: who it reaches now, and its name. */
export interface ResolvedTaskAudience {
  /** The chapter's Everyone role reads as the chapter itself. */
  kind: TaskAudienceTarget['kind'];
  /** The role or group, for `role` and `group`. */
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
    },
  ) {}

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

  /** The current name of a role or group of the chapter, or null once gone. */
  async nameOf(kind: 'role' | 'group', id: string): Promise<string | null> {
    const found = kind === 'role' ? await this.role(id) : await this.group(id);
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
    });
  }

  /**
   * The current names of these roles and groups of the chapter, by id; one
   * since deleted is absent. Read only for the kinds asked about.
   */
  async liveNames(
    chapterId: string,
    ids: { roleIds: string[]; groupIds: string[] },
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const [roles, groups] = await Promise.all([
      ids.roleIds.length > 0
        ? this.roleRepo.findByIds(ids.roleIds, chapterId)
        : [],
      ids.groupIds.length > 0 ? this.groupRepo.findByChapter(chapterId) : [],
    ]);
    for (const role of roles) names.set(role.id, role.name);
    const wanted = new Set(ids.groupIds);
    for (const group of groups) {
      if (wanted.has(group.id)) names.set(group.id, group.name);
    }
    return names;
  }
}
