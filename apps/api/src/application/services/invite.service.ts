import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { INVITE_REPOSITORY } from '../../domain/repositories/invite.repository.interface';
import type { IInviteRepository } from '../../domain/repositories/invite.repository.interface';
import { Invite } from '../../domain/entities/invite.entity';
import { randomBytes } from 'crypto';

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    @Inject(INVITE_REPOSITORY)
    private readonly inviteRepo: IInviteRepository,
  ) {}

  /**
   * Generates a new secure invite token.
   */
  async createInvite(data: {
    chapterId: string;
    role: string;
    createdBy: string;
  }): Promise<Invite> {
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24hr expiration

    this.logger.log(`Creating invite for chapter ${data.chapterId}`);

    return this.inviteRepo.create({
      ...data,
      token,
      expiresAt,
    });
  }

  /**
   * Validates and processes an invite acceptance.
   * Note: The actual "Adding to Chapter" logic will be handled by membership repository later.
   */
  async acceptInvite(token: string, userId: string): Promise<Invite> {
    const invite = await this.inviteRepo.findByToken(token);

    if (!invite) {
      this.logger.warn(`Failed invite attempt: Token ${token} not found`);
      throw new NotFoundException('Invite token not found');
    }

    if (invite.usedAt) {
      throw new BadRequestException('Invite has already been used');
    }

    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite has expired');
    }

    this.logger.log(
      `User ${userId} accepted invite for chapter ${invite.chapterId}`,
    );

    await this.inviteRepo.markAsUsed(invite.id);
    return invite;
  }
}
