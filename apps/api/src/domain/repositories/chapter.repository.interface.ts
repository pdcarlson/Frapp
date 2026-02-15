import { Chapter } from '../entities/chapter.entity';

export const CHAPTER_REPOSITORY = 'CHAPTER_REPOSITORY';

export interface IChapterRepository {
  create(data: {
    name: string;
    university?: string;
    clerkOrganizationId?: string;
    stripeCustomerId?: string;
    subscriptionStatus?: string;
    subscriptionId?: string;
  }): Promise<Chapter>;

  update(
    id: string,
    data: Partial<{
      name: string;
      university: string;
      subscriptionStatus: string;
      subscriptionId: string;
    }>,
  ): Promise<Chapter>;

  findByClerkOrganizationId(
    clerkOrganizationId: string,
  ): Promise<Chapter | null>;

  findById(id: string): Promise<Chapter | null>;
}
