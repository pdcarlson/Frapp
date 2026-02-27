import { Invite } from '../entities/invite.entity';

export const INVITE_REPOSITORY = 'INVITE_REPOSITORY';

export interface IInviteRepository {
  findByToken(token: string): Promise<Invite | null>;
  findByChapter(chapterId: string): Promise<Invite[]>;
  create(data: Partial<Invite>): Promise<Invite>;
  markUsed(id: string): Promise<void>;
  markUsedAtomically(id: string): Promise<boolean>;
}
