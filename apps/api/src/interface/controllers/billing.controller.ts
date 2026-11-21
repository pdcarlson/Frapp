import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from '../../application/services/billing.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { SubscriptionExempt } from '../decorators/subscription.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { CreateCheckoutDto, CreatePortalDto } from '../dtos/billing.dto';
import { FeatureEvent } from '../decorators/feature-event.decorator';
import { assertDashboardReturnUrl } from '../http/dashboard-return-url';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.BILLING_VIEW)
@SubscriptionExempt()
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get chapter billing status' })
  async getStatus(@CurrentChapterId() chapterId: string) {
    return this.billingService.getChapterBillingStatus(chapterId);
  }

  @Post('checkout')
  @RequirePermissions(SystemPermissions.BILLING_MANAGE)
  @ApiOperation({ summary: 'Create Stripe Checkout session' })
  @FeatureEvent('checkout-started')
  async createCheckout(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    const url = await this.billingService.createCheckoutSession({
      chapterId,
      customerEmail: dto.customer_email,
      successUrl: assertDashboardReturnUrl(dto.success_url, 'success_url'),
      cancelUrl: assertDashboardReturnUrl(dto.cancel_url, 'cancel_url'),
    });
    return { url };
  }

  @Post('portal')
  @RequirePermissions(SystemPermissions.BILLING_MANAGE)
  @ApiOperation({ summary: 'Create Stripe Customer Portal session' })
  async createPortal(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreatePortalDto,
  ) {
    const url = await this.billingService.createPortalSession({
      chapterId,
      returnUrl: assertDashboardReturnUrl(dto.return_url, 'return_url'),
    });
    return { url };
  }
}
