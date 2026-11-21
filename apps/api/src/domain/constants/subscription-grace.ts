import { isWithinSubscriptionGrace } from '@repo/validation';
import type { Chapter } from '../entities/chapter.entity';

/**
 * FRA-109: a chapter that lapses to `past_due` gets a 3-day grace window
 * (spec/behavior/billing.md, spec/product/onboarding.md) before the hard
 * read-only lock applies.
 *
 * The window and its rule are `@repo/validation`'s, re-exported here for the
 * API's readers. The guard is not the only place the window matters:
 * `POST /v1/invites/redeem` carries no `ChapterGuard` (the chapter that
 * matters there is the *invite's*, not the caller's) and evaluates the same
 * window itself (#1546). One number, one rule, or the two drift and a token
 * minted before a lapse is honoured by one path and refused by the other.
 */
export {
  SUBSCRIPTION_GRACE_PERIOD_MS,
  isWithinSubscriptionGrace,
} from '@repo/validation';

/**
 * Whether a chapter is under the subscription hard lock — `canceled`, or
 * `past_due` with its grace window spent. This is the state in which
 * `ChapterGuard` refuses every guarded write, and it is the state in which a
 * route that carries no guard must refuse the writes the spec says the lock
 * covers (`spec/behavior/data-retention.md`: a locked chapter cannot gain
 * members). `active`, `incomplete` and `past_due`-within-grace are not locked.
 */
export function isSubscriptionHardLocked(
  chapter: Pick<Chapter, 'subscription_status' | 'past_due_since'>,
  nowMs: number = Date.now(),
): boolean {
  if (chapter.subscription_status === 'canceled') return true;
  if (chapter.subscription_status === 'past_due') {
    return !isWithinSubscriptionGrace(chapter.past_due_since, nowMs);
  }
  return false;
}

/**
 * Whether a free-tier write (chat is one) may land in a chapter with this
 * subscription state, by `ChapterGuard.enforceSubscription`'s rule: never in a
 * canceled chapter, and in a past-due one only within grace. For a write that
 * doesn't come through the guard, such as a scheduled message the sweep posts
 * (#4956).
 */
export function freeTierWriteAllowed(
  status: string | null | undefined,
  pastDueSince: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (status === 'canceled') return false;
  if (status === 'past_due') {
    return isWithinSubscriptionGrace(pastDueSince, nowMs);
  }
  return true;
}
