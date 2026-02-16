import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { Member } from '../../domain/entities/member.entity';

@Injectable()
export class MemberService {
  private readonly logger = new Logger(MemberService.name);

  constructor(
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
  ) {}

  async assignRoles(memberId: string, roleIds: string[]): Promise<Member> {
    this.logger.log(
      `Assigning roles ${roleIds.join(', ')} to member ${memberId}`,
    );

    const member = await this.memberRepo.findById(memberId);
    if (!member) {
      throw new NotFoundException(`Member with ID ${memberId} not found`);
    }

    return this.memberRepo.updateRoles(memberId, roleIds);
  }

  async getMembersByChapter(chapterId: string): Promise<Member[]> {
    return this.memberRepo.findByChapter(chapterId);
  }

  async getMember(memberId: string): Promise<Member> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) {
      throw new NotFoundException(`Member with ID ${memberId} not found`);
    }
    return member;
  }
}
