import { Member } from '../entities/member.entity';

export const MEMBER_REPOSITORY = 'MEMBER_REPOSITORY';

export interface IMemberRepository {
  findById(id: string): Promise<Member | null>;
  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member | null>;
  findByChapter(chapterId: string): Promise<Member[]>;
  create(data: Partial<Member>): Promise<Member>;
  update(id: string, data: Partial<Member>): Promise<Member>;
  delete(id: string): Promise<void>;
}
