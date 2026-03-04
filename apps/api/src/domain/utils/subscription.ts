import type { SubscriptionStatus } from '../entities/chapter.entity';

/**
 * Write actions (invite, create resources) require an active subscription.
 * During the grace period (past_due), writes are blocked.
 */
export function canPerformWriteAction(status: SubscriptionStatus): boolean {
  return status === 'active';
}

/**
 * Read access continues during grace period (past_due) and incomplete states.
 * Only fully canceled chapters lose read access.
 */
export function canPerformReadAction(status: SubscriptionStatus): boolean {
  return (
    status === 'active' || status === 'past_due' || status === 'incomplete'
  );
}
