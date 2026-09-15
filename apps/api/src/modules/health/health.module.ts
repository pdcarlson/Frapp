import { Module } from '@nestjs/common';
import { HealthController } from '../../interface/controllers/health.controller';
import { StripePriceConsistencyModule } from '../../infrastructure/billing/stripe-price-consistency.module';
import { StripeWebhookConsistencyModule } from '../../infrastructure/billing/stripe-webhook-consistency.module';

@Module({
  imports: [StripePriceConsistencyModule, StripeWebhookConsistencyModule],
  controllers: [HealthController],
})
export class HealthModule {}
