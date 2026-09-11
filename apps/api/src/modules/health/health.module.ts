import { Module } from '@nestjs/common';
import { HealthController } from '../../interface/controllers/health.controller';
import { StripePriceConsistencyModule } from '../../infrastructure/billing/stripe-price-consistency.module';

@Module({
  imports: [StripePriceConsistencyModule],
  controllers: [HealthController],
})
export class HealthModule {}
