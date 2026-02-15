import { Invite } from '../entities/invite.entity';

export const INVITE_REPOSITORY = 'INVITE_REPOSITORY';

export interface IInviteRepository {
  create(data: {
    token: string;
    chapterId: string;
    role: string;
    expiresAt: Date;
    createdBy: string;
  }): Promise<Invite>;

  findByToken(token: string): Promise<Invite | null>;

  markAsUsed(id: string): Promise<void>;
}
