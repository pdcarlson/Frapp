import { Module } from '@nestjs/common';
import { BillingService } from '../../application/services/billing.service';
import { BillingController } from '../../interface/controllers/billing.controller';
import { WebhookController } from '../../interface/controllers/webhook.controller';
import { StripeBillingService } from '../../infrastructure/billing/stripe.service';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [BillingController, WebhookController],
  providers: [
    BillingService,
    { provide: BILLING_PROVIDER, useClass: StripeBillingService },
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: ROLE_REPOSITORY, useClass: SupabaseRoleRepository },
  ],
  exports: [BillingService, BILLING_PROVIDER],
})
export class BillingModule {}
