import { Module } from '@nestjs/common';
import { StripeWebhookConsistencyService } from '../../infrastructure/billing/stripe-webhook-consistency.service';

@Module({
  providers: [StripeWebhookConsistencyService],
  exports: [StripeWebhookConsistencyService],
})
export class StripeWebhookConsistencyModule {}
