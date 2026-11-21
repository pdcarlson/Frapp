import { Module } from '@nestjs/common';
import { StripePriceConsistencyService } from '../../infrastructure/billing/stripe-price-consistency.service';

@Module({
  providers: [StripePriceConsistencyService],
  exports: [StripePriceConsistencyService],
})
export class StripePriceConsistencyModule {}
