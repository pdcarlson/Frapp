import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { INVITE_REPOSITORY } from '../../domain/repositories/invite.repository.interface';
import type { IInviteRepository } from '../../domain/repositories/invite.repository.interface';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { Invite } from '../../domain/entities/invite.entity';
import { NotificationService } from './notification.service';

@Injectable()
export class InviteService {
  constructor(
    @Inject(INVITE_REPOSITORY) private readonly inviteRepo: IInviteRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async create(
    chapterId: string,
    createdBy: string,
    role: string,
  ): Promise<Invite> {
    const chapter = await this.chapterRepo.findById(chapterId);
    if (chapter?.subscription_status !== 'active') {
      throw new HttpException(
        'Chapter subscription is not active',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    return this.inviteRepo.create({
      token: uuidv4(),
      chapter_id: chapterId,
      role,
      expires_at: expiresAt.toISOString(),
      created_by: createdBy,
    });
  }

  async createBatch(
    chapterId: string,
    createdBy: string,
    role: string,
    count: number,
  ): Promise<Invite[]> {
    const invites: Invite[] = [];
    for (let i = 0; i < count; i++) {
      invites.push(await this.create(chapterId, createdBy, role));
    }
    return invites;
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
    let targetRole = roles.find((r) => r.name === invite.role);
    if (!targetRole) {
      targetRole = roles.find((r) => r.name === 'Member');
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
}
