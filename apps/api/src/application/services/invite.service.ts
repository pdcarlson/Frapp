import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { INVITE_REPOSITORY } from '../../domain/repositories/invite.repository.interface';
import type { IInviteRepository } from '../../domain/repositories/invite.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { Invite } from '../../domain/entities/invite.entity';
import { SystemRoleKeys } from '../../domain/constants/permissions';
import { NotificationService } from './notification.service';

@Injectable()
export class InviteService {
  constructor(
    @Inject(INVITE_REPOSITORY) private readonly inviteRepo: IInviteRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    private readonly notificationService: NotificationService,
  ) {}

  private prepareInviteData(
    chapterId: string,
    createdBy: string,
    role: string,
  ): Partial<Invite> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    return {
      token: uuidv4(),
      chapter_id: chapterId,
      role,
      expires_at: expiresAt.toISOString(),
      created_by: createdBy,
    };
  }

  async create(
    chapterId: string,
    createdBy: string,
    role: string,
  ): Promise<Invite> {
    // Free tier: inviting members is not billing-gated (Chunk 03). The chat +
    // members wedge is available to every chapter regardless of subscription.
    const data = this.prepareInviteData(chapterId, createdBy, role);
    return this.inviteRepo.create(data);
  }

  async createBatch(
    chapterId: string,
    createdBy: string,
    role: string,
    count: number,
  ): Promise<Invite[]> {
    const inviteData: Partial<Invite>[] = Array.from({ length: count }, () =>
      this.prepareInviteData(chapterId, createdBy, role),
    );

    return this.inviteRepo.createMany(inviteData);
  }

  async redeem(
    token: string,
    userId: string,
  ): Promise<{ chapterId: string; memberId: string }> {
    const invite = await this.inviteRepo.findByToken(token);

    if (!invite) throw new GoneException('Invite not found');
    if (invite.used_at) throw new GoneException('Invite already used');
    if (new Date(invite.expires_at) < new Date())
      throw new GoneException('Invite expired');

    const existingMember = await this.memberRepo.findByUserAndChapter(
      userId,
      invite.chapter_id,
    );
    if (existingMember)
      throw new ConflictException('Already a member of this chapter');

    const claimed = await this.inviteRepo.markUsedAtomically(invite.id);
    if (!claimed) throw new GoneException('Invite already used');

    const roles = await this.roleRepo.findByChapter(invite.chapter_id);
    // `invite.role` is the display name chosen when the invite was issued, so
    // it is matched by name by design. The fallback is the seeded Member role,
    // which resolves by `system_key` — a chapter that relabelled it would
    // otherwise leave redeemers with no role at all.
    let targetRole = roles.find((r) => r.name === invite.role);
    if (!targetRole) {
      targetRole = roles.find((r) => r.system_key === SystemRoleKeys.MEMBER);
    }

    const member = await this.memberRepo.create({
      user_id: userId,
      chapter_id: invite.chapter_id,
      role_ids: targetRole ? [targetRole.id] : [],
    });

    try {
      await this.notificationService.notifyChapter(invite.chapter_id, {
        title: 'New Member Joined',
        body: 'A new member has joined the chapter',
        priority: 'NORMAL',
        category: 'admin',
        data: { target: { screen: 'members' } },
      });
    } catch {}

    return { chapterId: invite.chapter_id, memberId: member.id };
  }

  async findByChapter(chapterId: string): Promise<Invite[]> {
    return this.inviteRepo.findByChapter(chapterId);
  }

  async revoke(id: string, chapterId: string): Promise<void> {
    const invite = await this.inviteRepo.findById(id);

    if (!invite || invite.chapter_id !== chapterId) {
      throw new NotFoundException('Invite not found');
    }

    if (invite.used_at) {
      throw new BadRequestException('Invite has already been used');
    }

    await this.inviteRepo.markUsed(id);
  }
}
