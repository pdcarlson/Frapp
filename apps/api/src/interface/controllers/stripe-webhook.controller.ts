import {
  Controller,
  Post,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StripeWebhookGuard } from '../guards/stripe-webhook.guard';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import type { RequestWithHeaders } from '../auth.types';

@ApiTags('webhooks')
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly onboardingService: ChapterOnboardingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(StripeWebhookGuard)
  @ApiOperation({ summary: 'Handle webhooks from Stripe' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async handleWebhook(@Request() req: RequestWithHeaders) {
    if (!req.billingEvent) {
      this.logger.error('Billing event missing from request object');
      throw new Error('Processing failed');
    }

    await this.onboardingService.handleBillingWebhook(req.billingEvent);
    return { received: true };
  }
}
