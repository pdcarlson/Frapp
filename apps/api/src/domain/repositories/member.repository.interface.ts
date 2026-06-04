import { Member } from '../entities/member.entity';

export const MEMBER_REPOSITORY = 'MEMBER_REPOSITORY';

export interface IMemberRepository {
  findById(id: string): Promise<Member | null>;
  findByUser(userId: string): Promise<Member[]>;
  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member | null>;
  findByChapter(chapterId: string): Promise<Member[]>;
  create(data: Partial<Member>): Promise<Member>;
  update(id: string, data: Partial<Member>): Promise<Member>;
  delete(id: string): Promise<void>;
  /**
   * Atomically move the President (wildcard) role from one member to another via
   * the `transfer_presidency` RPC (single DB transaction). Resolves to `true` on
   * success, or `false` when the current member no longer holds the role in the
   * chapter (race lost / stale read) so the caller can surface a 403.
   */
  transferPresidencyAtomic(
    chapterId: string,
    currentMemberId: string,
    targetMemberId: string,
    presidentRoleId: string,
  ): Promise<boolean>;
}
