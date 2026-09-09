import { Chapter, SubscriptionStatus } from '../entities/chapter.entity';

export const CHAPTER_REPOSITORY = 'CHAPTER_REPOSITORY';

/**
 * Sparse patch for `apply_subscription_webhook`. Absent keys are left
 * untouched; `null` clears a nullable column. `last_stripe_webhook_at` is
 * not in the patch — the RPC stamps it from the event timestamp on a win.
 *
 * `activate_if` is the `invoice.paid` contract: set `subscription_status` to
 * `active` (and clear `past_due_since`) only when the row is still one of
 * those statuses at UPDATE time. A patch that decided `{active}` against a
 * stale `past_due` snapshot therefore cannot un-cancel a row that moved on.
 */
export type SubscriptionWebhookPatch = {
  subscription_status?: SubscriptionStatus;
  past_due_since?: string | null;
  subscription_id?: string | null;
  stripe_customer_id?: string | null;
  activate_if?: Array<'past_due' | 'incomplete'>;
};

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
  /**
   * Compare-and-set a subscription webhook onto the chapter (#731).
   *
   * Updates only while `last_stripe_webhook_at` is null or `<= eventAt`.
   * Concurrent deliveries that both passed the in-memory stale check therefore
   * cannot both write: the loser updates zero rows and gets `null`. Same-second
   * events are allowed through (Stripe `event.created` is whole seconds).
   */
  applySubscriptionWebhook(
    chapterId: string,
    eventAt: string,
    patch: SubscriptionWebhookPatch,
  ): Promise<Chapter | null>;
  create(data: Partial<Chapter>): Promise<Chapter>;
  update(id: string, data: Partial<Chapter>): Promise<Chapter>;
}
