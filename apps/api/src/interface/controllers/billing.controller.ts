import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from '../../application/services/billing.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import { CreateCheckoutDto, CreatePortalDto } from '../dtos/billing.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('status')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.BILLING_VIEW)
  @ApiOperation({ summary: 'Get chapter billing status' })
  async getStatus(@CurrentChapterId() chapterId: string) {
    return this.billingService.getChapterBillingStatus(chapterId);
  }

  @Post('checkout')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.BILLING_MANAGE)
  @ApiOperation({ summary: 'Create Stripe Checkout session' })
  async createCheckout(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    const url = await this.billingService.createCheckoutSession({
      chapterId,
      customerEmail: dto.customer_email,
      successUrl: dto.success_url,
      cancelUrl: dto.cancel_url,
    });
    return { url };
  }

  @Post('portal')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.BILLING_MANAGE)
  @ApiOperation({ summary: 'Create Stripe Customer Portal session' })
  async createPortal(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreatePortalDto,
  ) {
    const url = await this.billingService.createPortalSession({
      chapterId,
      returnUrl: dto.return_url,
    });
    return { url };
  }
}
