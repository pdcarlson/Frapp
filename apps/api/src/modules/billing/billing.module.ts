import { Module, Global } from '@nestjs/common';
import { StripeService } from '../../infrastructure/billing/stripe.service';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';

@Global()
@Module({
  providers: [
    {
      provide: BILLING_PROVIDER,
      useClass: StripeService,
    },
  ],
  exports: [BILLING_PROVIDER],
})
export class BillingModule {}
