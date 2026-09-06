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
  /**
   * Compare-and-set the Stripe subscription this chapter bills against.
   *
   * Writes `subscription_id` only while the stored value is still
   * `expectedSubscriptionId` (including `null`) **and** the chapter is not
   * holding a live subscription (`active` / `past_due`). Two concurrent
   * webhook deliveries therefore cannot both claim the row: the loser
   * updates zero rows and gets `null`. The caller reloads by the incoming
   * id and continues only when that id owns the chapter.
   */
  claimSubscriptionId(
    chapterId: string,
    subscriptionId: string,
    expectedSubscriptionId: string | null,
  ): Promise<Chapter | null>;
  create(data: Partial<Chapter>): Promise<Chapter>;
  update(id: string, data: Partial<Chapter>): Promise<Chapter>;
}
