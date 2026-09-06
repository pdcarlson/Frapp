import type { Chapter } from '../entities/chapter.entity';

/**
 * FRA-109: a chapter that lapses to `past_due` gets a 3-day grace window
 * (spec/behavior/billing.md, spec/product/onboarding.md) before the hard
 * read-only lock applies.
 *
 * Owned here rather than inside `ChapterGuard` because the guard is not the
 * only place the window matters: `POST /v1/invites/redeem` carries no
 * `ChapterGuard` — the chapter that matters there is the *invite's*, not the
 * caller's — and has to evaluate the same window itself (#1546). One number,
 * one rule, or the two drift and a token minted before a lapse is honoured by
 * one path and refused by the other.
 */
export const SUBSCRIPTION_GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * A `past_due` chapter is within its grace window when less than
 * {@link SUBSCRIPTION_GRACE_PERIOD_MS} has elapsed since it lapsed. A null or
 * unparseable timestamp (legacy row, or a missed webhook) is treated as within
 * grace — the safer default that preserves access rather than instantly
 * hard-locking a lapsed-but-paying chapter; the next webhook re-establishes
 * the clock.
 */
export function isWithinSubscriptionGrace(
  pastDueSince: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!pastDueSince) return true;
  const lapsedAt = Date.parse(pastDueSince);
  if (Number.isNaN(lapsedAt)) return true;
  return nowMs - lapsedAt <= SUBSCRIPTION_GRACE_PERIOD_MS;
}

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
