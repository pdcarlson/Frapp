import {
  SUBSCRIPTION_GRACE_PERIOD_MS,
  isSubscriptionHardLocked,
  isWithinSubscriptionGrace,
} from './subscription-grace';

describe('subscription grace', () => {
  const NOW = Date.parse('2026-06-10T12:00:00.000Z');
  const daysAgo = (days: number) =>
    new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

  it('is three days', () => {
    expect(SUBSCRIPTION_GRACE_PERIOD_MS).toBe(3 * 24 * 60 * 60 * 1000);
  });

  describe('isWithinSubscriptionGrace', () => {
    it('is inside the window until exactly three days have elapsed', () => {
      expect(isWithinSubscriptionGrace(daysAgo(1), NOW)).toBe(true);
      expect(isWithinSubscriptionGrace(daysAgo(3), NOW)).toBe(true);
      expect(isWithinSubscriptionGrace(daysAgo(3.01), NOW)).toBe(false);
    });

    it('treats a missing or unparseable timestamp as within grace', () => {
      // A legacy row or a missed webhook must not hard-lock a paying chapter.
      expect(isWithinSubscriptionGrace(null, NOW)).toBe(true);
      expect(isWithinSubscriptionGrace('not a date', NOW)).toBe(true);
    });
  });

  describe('isSubscriptionHardLocked', () => {
    it('locks a canceled chapter regardless of the clock', () => {
      expect(
        isSubscriptionHardLocked(
          { subscription_status: 'canceled', past_due_since: null },
          NOW,
        ),
      ).toBe(true);
    });

    it('locks past_due only once grace has run out', () => {
      expect(
        isSubscriptionHardLocked(
          { subscription_status: 'past_due', past_due_since: daysAgo(1) },
          NOW,
        ),
      ).toBe(false);
      expect(
        isSubscriptionHardLocked(
          { subscription_status: 'past_due', past_due_since: daysAgo(4) },
          NOW,
        ),
      ).toBe(true);
    });

    it('never locks active or incomplete', () => {
      expect(
        isSubscriptionHardLocked(
          { subscription_status: 'active', past_due_since: null },
          NOW,
        ),
      ).toBe(false);
      expect(
        isSubscriptionHardLocked(
          { subscription_status: 'incomplete', past_due_since: daysAgo(30) },
          NOW,
        ),
      ).toBe(false);
    });
  });
});
