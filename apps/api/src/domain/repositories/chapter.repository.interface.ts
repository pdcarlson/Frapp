import { Chapter } from '../entities/chapter.entity';

export const CHAPTER_REPOSITORY = 'CHAPTER_REPOSITORY';

export interface IChapterRepository {
  findById(id: string): Promise<Chapter | null>;
  findByStripeCustomerId(customerId: string): Promise<Chapter | null>;
  findBySubscriptionId(subscriptionId: string): Promise<Chapter | null>;
  create(data: Partial<Chapter>): Promise<Chapter>;
  update(id: string, data: Partial<Chapter>): Promise<Chapter>;
}
