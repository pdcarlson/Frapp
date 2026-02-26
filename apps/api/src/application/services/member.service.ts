import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { Member } from '../../domain/entities/member.entity';

@Injectable()
export class MemberService {
  constructor(
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
  ) {}

  async findByChapter(chapterId: string): Promise<Member[]> {
    return this.memberRepo.findByChapter(chapterId);
  }

  async findByUserAndChapter(userId: string, chapterId: string): Promise<Member> {
    const member = await this.memberRepo.findByUserAndChapter(userId, chapterId);
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async updateRoles(memberId: string, roleIds: string[]): Promise<Member> {
    return this.memberRepo.update(memberId, { role_ids: roleIds });
  }

  async updateOnboarding(memberId: string, completed: boolean): Promise<Member> {
    return this.memberRepo.update(memberId, { has_completed_onboarding: completed });
  }

  async remove(memberId: string): Promise<void> {
    await this.memberRepo.delete(memberId);
  }
}
