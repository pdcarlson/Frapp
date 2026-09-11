import { Module } from '@nestjs/common';
import { StripePriceConsistencyService } from './stripe-price-consistency.service';

@Module({
  providers: [StripePriceConsistencyService],
  exports: [StripePriceConsistencyService],
})
export class StripePriceConsistencyModule {}
