import { Module, Global, forwardRef } from '@nestjs/common';
import { StripeService } from '../../infrastructure/billing/stripe.service';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import { StripeWebhookController } from '../../interface/controllers/stripe-webhook.controller';
import { StripeWebhookGuard } from '../../interface/guards/stripe-webhook.guard';
import { ChapterModule } from '../chapter/chapter.module';
import { FinancialModule } from '../financial/financial.module';

@Global()
@Module({
  imports: [ChapterModule, forwardRef(() => FinancialModule)],
  controllers: [StripeWebhookController],
  providers: [
    {
      provide: BILLING_PROVIDER,
      useClass: StripeService,
    },
    StripeWebhookGuard,
  ],
  exports: [BILLING_PROVIDER, StripeWebhookGuard],
})
export class BillingModule {}
