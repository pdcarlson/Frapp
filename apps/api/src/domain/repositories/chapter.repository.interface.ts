import { Chapter } from '../entities/chapter.entity';

export const CHAPTER_REPOSITORY = 'CHAPTER_REPOSITORY';

export interface IChapterRepository {
  findById(id: string): Promise<Chapter | null>;
  findBySubscriptionId(subscriptionId: string): Promise<Chapter | null>;
  /**
   * Resolve a chapter by its Stripe customer. `chapters.stripe_customer_id` is
   * `unique`, and it is written by `createCheckoutSession` *before* the Stripe
   * session exists — so it is populated exactly when `subscription_id` is not
   * yet (#1738).
   */
  findByCustomerId(customerId: string): Promise<Chapter | null>;
  create(data: Partial<Chapter>): Promise<Chapter>;
  update(id: string, data: Partial<Chapter>): Promise<Chapter>;
}
