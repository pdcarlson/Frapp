import { canPerformWriteAction, canPerformReadAction } from './subscription';
import type { SubscriptionStatus } from '../entities/chapter.entity';

describe('subscription utils', () => {
  describe('canPerformWriteAction', () => {
    it('should allow writes for active subscriptions', () => {
      expect(canPerformWriteAction('active')).toBe(true);
    });

    it.each<SubscriptionStatus>(['past_due', 'canceled', 'incomplete'])(
      'should block writes for %s subscriptions',
      (status) => {
        expect(canPerformWriteAction(status)).toBe(false);
      },
    );
  });

  describe('canPerformReadAction', () => {
    it.each<SubscriptionStatus>(['active', 'past_due', 'incomplete'])(
      'should allow reads for %s subscriptions',
      (status) => {
        expect(canPerformReadAction(status)).toBe(true);
      },
    );

    it('should block reads for canceled subscriptions', () => {
      expect(canPerformReadAction('canceled')).toBe(false);
    });
  });
});
