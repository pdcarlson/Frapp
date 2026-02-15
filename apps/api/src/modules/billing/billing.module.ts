import { Module, Global } from '@nestjs/common';
import { StripeService } from '../../infrastructure/billing/stripe.service';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import { StripeWebhookController } from '../../interface/controllers/stripe-webhook.controller';
import { StripeWebhookGuard } from '../../interface/guards/stripe-webhook.guard';
import { ChapterModule } from '../chapter/chapter.module';

@Global()
@Module({
  imports: [ChapterModule],
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
