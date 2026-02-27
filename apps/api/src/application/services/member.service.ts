import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { Member } from '../../domain/entities/member.entity';
import { User } from '../../domain/entities/user.entity';

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
}

@Injectable()
export class MemberService {
  constructor(
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
  ) {}

  async findByChapter(chapterId: string): Promise<Member[]> {
    return this.memberRepo.findByChapter(chapterId);
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

  async updateRoles(memberId: string, roleIds: string[]): Promise<Member> {
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

  async remove(memberId: string): Promise<void> {
    await this.memberRepo.delete(memberId);
  }

  async findProfileById(
    memberId: string,
    chapterId: string,
  ): Promise<MemberProfile> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.chapter_id !== chapterId) {
      throw new ForbiddenException('Member not in current chapter');
    }
    const user = await this.userRepo.findById(member.user_id);
    if (!user) throw new NotFoundException('User not found');
    return this.mergeMemberWithUser(member, user);
  }

  async searchByChapterAndName(
    chapterId: string,
    query: string,
  ): Promise<MemberProfile[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((m) => m.user_id))];
    const users = await this.userRepo.findByIds(userIds);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const q = query.trim().toLowerCase();
    const results: MemberProfile[] = [];
    for (const member of members) {
      const user = userMap.get(member.user_id);
      if (user && user.display_name.toLowerCase().includes(q)) {
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
      'Alumni',
    );
    if (!alumniRole) return [];

    const members = await this.memberRepo.findByChapter(chapterId);
    const alumniMembers = members.filter((m) =>
      m.role_ids.includes(alumniRole.id),
    );
    if (!alumniMembers.length) return [];

    const userIds = [...new Set(alumniMembers.map((m) => m.user_id))];
    const users = await this.userRepo.findByIds(userIds);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const results: MemberProfile[] = [];
    for (const member of alumniMembers) {
      const user = userMap.get(member.user_id);
      if (user) {
        const profile = this.mergeMemberWithUser(member, user);
        if (this.matchesAlumniFilter(profile, filter)) {
          results.push(profile);
        }
      }
    }
    return results;
  }

  private matchesAlumniFilter(
    profile: MemberProfile,
    filter?: AlumniFilter,
  ): boolean {
    if (!filter) return true;
    if (
      filter.graduation_year !== undefined &&
      profile.graduation_year !== filter.graduation_year
    ) {
      return false;
    }
    if (filter.city !== undefined) {
      const cityMatch = profile.current_city
        ?.toLowerCase()
        .includes(filter.city.toLowerCase());
      if (!cityMatch) return false;
    }
    if (filter.company !== undefined) {
      const companyMatch = profile.current_company
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
