import { Member } from '../entities/member.entity';

export const MEMBER_REPOSITORY = 'MEMBER_REPOSITORY';

export interface IMemberRepository {
  create(data: {
    userId: string;
    chapterId: string;
    roleIds?: string[];
  }): Promise<Member>;

  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member | null>;

  findById(id: string): Promise<Member | null>;

  findByChapter(chapterId: string): Promise<Member[]>;

  updateRoles(id: string, roleIds: string[]): Promise<Member>;
}
