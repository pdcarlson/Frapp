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
  ALUMNI_ROLE_NAME,
  SystemPermissions,
} from '../../domain/constants/permissions';
import { CustomFieldService } from './custom-field.service';
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

@Injectable()
export class MemberService {
  constructor(
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    private readonly customFieldService: CustomFieldService,
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
  ): Promise<Member> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.chapter_id !== chapterId) {
      throw new ForbiddenException('Member not in current chapter');
    }

    const roles = await this.roleRepo.findByChapter(chapterId);
    const validRoleIds = new Set(roles.map((r) => r.id));
    const unknownRoleIds = roleIds.filter((id) => !validRoleIds.has(id));
    if (unknownRoleIds.length > 0) {
      throw new BadRequestException(
        `Role IDs do not belong to this chapter: ${unknownRoleIds.join(', ')}`,
      );
    }

    const presidentRole = roles.find(
      (r) => r.is_system && r.permissions.includes(SystemPermissions.WILDCARD),
    );

    if (presidentRole) {
      const currentlyHasPresident = member.role_ids.includes(presidentRole.id);
      const willHavePresident = roleIds.includes(presidentRole.id);
      if (currentlyHasPresident !== willHavePresident) {
        // Presidency moves must go through RbacService.transferPresidency so
        // the wildcard role is atomically reassigned and only the current
        // President can initiate it.
        throw new ForbiddenException(
          'Use the presidency-transfer endpoint to change the President role',
        );
      }
    }

    return this.memberRepo.update(memberId, { role_ids: roleIds });
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
    const alumniRole = await this.roleRepo.findByChapterAndName(
      chapterId,
      ALUMNI_ROLE_NAME,
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
