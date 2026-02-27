import { Module } from '@nestjs/common';
import { BillingService } from '../../application/services/billing.service';
import { BillingController } from '../../interface/controllers/billing.controller';
import { WebhookController } from '../../interface/controllers/webhook.controller';
import { StripeBillingService } from '../../infrastructure/billing/stripe.service';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';

@Module({
  controllers: [BillingController, WebhookController],
  providers: [
    BillingService,
    { provide: BILLING_PROVIDER, useClass: StripeBillingService },
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
  ],
  exports: [BillingService, BILLING_PROVIDER],
})
export class BillingModule {}
