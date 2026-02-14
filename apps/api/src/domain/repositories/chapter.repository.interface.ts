import { Chapter } from '../entities/chapter.entity';

export const CHAPTER_REPOSITORY = 'CHAPTER_REPOSITORY';

export interface IChapterRepository {
  create(chapter: {
    name: string;
    clerkOrganizationId?: string;
  }): Promise<Chapter>;
  findByClerkOrganizationId(
    clerkOrganizationId: string,
  ): Promise<Chapter | null>;
  findById(id: string): Promise<Chapter | null>;
}
