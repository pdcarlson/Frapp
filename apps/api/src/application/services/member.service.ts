import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { Member } from '../../domain/entities/member.entity';
import { User } from '../../domain/entities/user.entity';
import {
  SystemPermissions,
  SystemRoleKeys,
} from '../../domain/constants/permissions';
import { CustomFieldService } from './custom-field.service';
import { CustomRoleService } from './custom-role.service';
import { RbacService } from './rbac.service';
import { allowedVisibilities } from './custom-field-visibility';
import type { MemberCustomFieldValue } from '../../domain/entities/chapter-custom-field.entity';

export interface AlumniFilter {
  graduation_year?: number;
  city?: string;
  company?: string;
}

export interface MemberProfile {
  id: string;
  user_id: string;
  chapter_id: string;
  role_ids: string[];
  custom_role_ids: string[];
  has_completed_onboarding: boolean;
  created_at: string;
  updated_at: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  graduation_year: number | null;
  current_city: string | null;
  current_company: string | null;
  email: string;
  /**
   * Custom-field values, present only on single-member reads
   * (`findProfileById`) and already filtered to the fields the requesting
   * viewer may see. Omitted from list responses.
   */
  custom_fields?: MemberCustomFieldValue[];
}

export type MemberSummary = MemberProfile;

/**
 * One roster row: enough to render a name and an avatar, and nothing else.
 * Keyed by `user_id` rather than the membership `id` because every consumer
 * looks up by the id chat carries — `chat_messages.sender_id` and a DM
 * channel's `member_ids` are both `users.id`.
 */
export interface MemberRosterEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

/** A {@link MemberRosterEntry} plus the membership's join timestamp. */
export interface RecentMemberJoin extends MemberRosterEntry {
  joined_at: string;
}

@Injectable()
export class MemberService {
  constructor(
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    private readonly customFieldService: CustomFieldService,
    private readonly customRoleService: CustomRoleService,
    private readonly rbacService: RbacService,
  ) {}

  async findByChapter(chapterId: string): Promise<MemberSummary[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((member) => member.user_id))];
    const users = await this.userRepo.findByIds(userIds);
    const userMap = new Map(users.map((user) => [user.id, user]));

    return members.map((member) => {
      const user = userMap.get(member.user_id);
      if (!user) {
        throw new NotFoundException(
          `User not found for member ${member.id} in chapter ${chapterId}`,
        );
      }
      return this.mergeMemberWithUser(member, user);
    });
  }

  async findProfilesByChapter(chapterId: string): Promise<MemberProfile[]> {
    return this.findByChapter(chapterId);
  }

  /**
   * The chapter roster projected to display fields only.
   *
   * Exists so a display surface can resolve a `users.id` to something human
   * without pulling {@link MemberProfile}, which carries `email`, `bio`,
   * `graduation_year`, `current_city` and `current_company`. Chat resolves
   * author names and DM titles on the client, so the fat profile would put the
   * whole chapter's contact details on every member's device to render a name
   * (#1000, and the over-fetch #986 objects to).
   *
   * Costs the membership read plus one chunked user read per `ID_CHUNK_SIZE`
   * ids — two round trips for a chapter up to 100 members, three up to 200 —
   * and the chunks go out concurrently, so latency stays near one. Note the
   * membership read is still `select('*')` and only `user_id` is used from it;
   * narrowing that is separate work.
   *
   * Unlike {@link findByChapter} a member whose user row is missing is skipped
   * rather than thrown on: one orphaned membership row must not 500 the entire
   * chat surface.
   */
  async findRosterByChapter(chapterId: string): Promise<MemberRosterEntry[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((member) => member.user_id))];
    const identities = await this.userRepo.findDisplayIdentitiesByIds(userIds);
    const byId = new Map(identities.map((user) => [user.id, user]));

    const roster: MemberRosterEntry[] = [];
    for (const userId of userIds) {
      const user = byId.get(userId);
      if (!user) continue;
      roster.push({
        user_id: user.id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      });
    }
    return roster;
  }

  /**
   * The full roster, each entry also carrying its membership join timestamp —
   * for the Activity Feed (`spec/behavior/activity-feed.md`), which needs
   * both a `user_id → {display_name, avatar_url}` lookup (to name the actor
   * behind a backwork upload or announcement) *and* the most recently joined
   * members, from one caller. Built as one combined method rather than two —
   * {@link findRosterByChapter} plus a separate recent-joins query — so that
   * caller does one membership read and one identity batch, not two of each.
   *
   * `Member.created_at` is the membership row's timestamp, i.e. when this
   * person joined *this chapter* — not `users.created_at`, which is account
   * creation and could predate the membership by any amount (a re-join, an
   * alumni account reactivated years later).
   */
  async findRosterWithJoinDates(
    chapterId: string,
  ): Promise<RecentMemberJoin[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((member) => member.user_id))];
    const identities = await this.userRepo.findDisplayIdentitiesByIds(userIds);
    const byId = new Map(identities.map((user) => [user.id, user]));

    const roster: RecentMemberJoin[] = [];
    for (const member of members) {
      const user = byId.get(member.user_id);
      if (!user) continue;
      roster.push({
        user_id: user.id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        joined_at: member.created_at,
      });
    }
    return roster;
  }

  async findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async updateRoles(
    memberId: string,
    roleIds: string[],
    chapterId: string,
    customRoleIds?: string[],
  ): Promise<Member> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.chapter_id !== chapterId) {
      throw new ForbiddenException('Member not in current chapter');
    }

    // Both validation fetches depend only on the chapter, so run them together.
    const [roles, customRoles] = await Promise.all([
      this.roleRepo.findByChapter(chapterId),
      customRoleIds !== undefined && customRoleIds.length > 0
        ? this.customRoleService.findByIds(customRoleIds, chapterId)
        : Promise.resolve([]),
    ]);

    // Ids the member ALREADY holds are exempt from validation on both role
    // models: deleting a role leaves its id on member rows by design (spec
    // fail-safe — it resolves to no row and grants nothing), and a client
    // echoing that leftover back must not have its whole save rejected.
    const validRoleIds = new Set(roles.map((r) => r.id));
    const heldRoleIds = new Set(member.role_ids);
    const unknownRoleIds = roleIds.filter(
      (id) => !validRoleIds.has(id) && !heldRoleIds.has(id),
    );
    if (unknownRoleIds.length > 0) {
      throw new BadRequestException(
        `Role IDs do not belong to this chapter: ${unknownRoleIds.join(', ')}`,
      );
    }

    // Custom-role ids get the same cross-chapter validation and held-id
    // exemption as live-role ids. The exemption cannot smuggle a foreign id:
    // the held set only ever contains ids that passed this validation before.
    if (customRoleIds !== undefined && customRoleIds.length > 0) {
      const validCustomRoleIds = new Set(customRoles.map((r) => r.id));
      const heldCustomRoleIds = new Set(member.custom_role_ids ?? []);
      const unknownCustomRoleIds = customRoleIds.filter(
        (id) => !validCustomRoleIds.has(id) && !heldCustomRoleIds.has(id),
      );
      if (unknownCustomRoleIds.length > 0) {
        throw new BadRequestException(
          `Custom role IDs do not belong to this chapter: ${unknownCustomRoleIds.join(', ')}`,
        );
      }
    }

    // Wildcard-carrying roles move only through the presidency-transfer flow
    // (RbacService.transferPresidency), which reassigns them atomically and
    // only at the current President's initiative. Keying on the permission
    // rather than the seeded President row also blocks smuggling via any
    // legacy non-system role that carries `*`. Compared as SETS: neither the
    // member row nor the payload is guaranteed duplicate-free, and a
    // length-based comparison would both reject no-op saves and let a
    // duplicated held id mask an addition.
    const wildcardRoleIds = new Set(
      roles
        .filter((r) => r.permissions.includes(SystemPermissions.WILDCARD))
        .map((r) => r.id),
    );
    if (wildcardRoleIds.size > 0) {
      const currentlyHeld = new Set(
        member.role_ids.filter((id) => wildcardRoleIds.has(id)),
      );
      const willHold = new Set(roleIds.filter((id) => wildcardRoleIds.has(id)));
      const changed =
        currentlyHeld.size !== willHold.size ||
        [...currentlyHeld].some((id) => !willHold.has(id));
      if (changed) {
        throw new ForbiddenException(
          'Wildcard-carrying roles cannot be assigned or removed here: move the President role with the presidency-transfer flow, or strip the wildcard from a legacy role via role update first',
        );
      }
    }

    return this.memberRepo.update(memberId, {
      role_ids: roleIds,
      // Omitted → unchanged, so pre-bridge clients that send only `role_ids`
      // never strip a member's custom roles.
      ...(customRoleIds !== undefined
        ? { custom_role_ids: customRoleIds }
        : {}),
    });
  }

  async updateOnboarding(
    memberId: string,
    completed: boolean,
  ): Promise<Member> {
    return this.memberRepo.update(memberId, {
      has_completed_onboarding: completed,
    });
  }

  async remove(memberId: string, chapterId: string): Promise<void> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.chapter_id !== chapterId) {
      throw new ForbiddenException('Member not in current chapter');
    }
    await this.memberRepo.delete(memberId);
  }

  async findProfileById(
    memberId: string,
    chapterId: string,
    viewerUserId: string,
  ): Promise<MemberProfile> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.chapter_id !== chapterId) {
      throw new ForbiddenException('Member not in current chapter');
    }

    // The user fetch and the viewer's permission resolution are independent
    // (the latter keys off the viewer, not the target member), so run them
    // together rather than serially.
    const [user, permissions] = await Promise.all([
      this.userRepo.findById(member.user_id),
      this.rbacService.getEffectivePermissions(chapterId, viewerUserId),
    ]);
    if (!user) throw new NotFoundException('User not found');

    // Custom-field visibility is enforced server-side: resolve the viewer's
    // allowed visibility tiers from their effective permissions + whether they
    // are this member, then only those fields' values are fetched.
    const allowed = allowedVisibilities(
      permissions,
      member.user_id === viewerUserId,
    );
    const customFields =
      await this.customFieldService.findVisibleValuesForMember(
        chapterId,
        memberId,
        allowed,
      );

    return {
      ...this.mergeMemberWithUser(member, user),
      custom_fields: customFields,
    };
  }

  async searchByChapterAndName(
    chapterId: string,
    query: string,
  ): Promise<MemberProfile[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((m) => m.user_id))];
    const users = await this.userRepo.findByIds(userIds);

    const q = query.trim().toLowerCase();
    const filteredUsers = users.filter((u) =>
      u.display_name.toLowerCase().includes(q),
    );
    if (!filteredUsers.length) return [];

    const userMap = new Map(filteredUsers.map((u) => [u.id, u]));

    const results: MemberProfile[] = [];
    for (const member of members) {
      const user = userMap.get(member.user_id);
      if (user) {
        results.push(this.mergeMemberWithUser(member, user));
      }
    }
    return results;
  }

  async findAlumniByChapter(
    chapterId: string,
    filter?: AlumniFilter,
  ): Promise<MemberProfile[]> {
    const alumniRole = await this.roleRepo.findByChapterAndSystemKey(
      chapterId,
      SystemRoleKeys.ALUMNI,
    );
    if (!alumniRole) return [];

    const members = await this.memberRepo.findByChapter(chapterId);

    const alumniMembers: Member[] = [];
    const userIdsSet = new Set<string>();
    for (const m of members) {
      if (m.role_ids.includes(alumniRole.id)) {
        alumniMembers.push(m);
        userIdsSet.add(m.user_id);
      }
    }
    if (!alumniMembers.length) return [];

    const userIds = Array.from(userIdsSet);
    const users = await this.userRepo.findByIds(userIds);

    const filteredUsers = users.filter((u) =>
      this.matchesUserFilter(u, filter),
    );
    if (!filteredUsers.length) return [];

    const userMap = new Map(filteredUsers.map((u) => [u.id, u]));

    const results: MemberProfile[] = [];
    for (const member of alumniMembers) {
      const user = userMap.get(member.user_id);
      if (user) {
        results.push(this.mergeMemberWithUser(member, user));
      }
    }
    return results;
  }

  private matchesUserFilter(user: User, filter?: AlumniFilter): boolean {
    if (!filter) return true;
    if (
      filter.graduation_year !== undefined &&
      user.graduation_year !== filter.graduation_year
    ) {
      return false;
    }
    if (filter.city !== undefined) {
      const cityMatch = user.current_city
        ?.toLowerCase()
        .includes(filter.city.toLowerCase());
      if (!cityMatch) return false;
    }
    if (filter.company !== undefined) {
      const companyMatch = user.current_company
        ?.toLowerCase()
        .includes(filter.company.toLowerCase());
      if (!companyMatch) return false;
    }
    return true;
  }

  private mergeMemberWithUser(member: Member, user: User): MemberProfile {
    return {
      ...member,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      bio: user.bio,
      graduation_year: user.graduation_year,
      current_city: user.current_city,
      current_company: user.current_company,
      email: user.email,
    };
  }
}
