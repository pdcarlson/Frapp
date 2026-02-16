import {
  Controller,
  Post,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StripeWebhookGuard } from '../guards/stripe-webhook.guard';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { FinancialService } from '../../application/services/financial.service';
import type { RequestWithHeaders } from '../auth.types';

@ApiTags('webhooks')
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly onboardingService: ChapterOnboardingService,
    @Inject(forwardRef(() => FinancialService))
    private readonly financialService: FinancialService,
  ) {}

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

    const event = req.billingEvent;
    this.logger.log(`Received Stripe event: ${event.type}`);

    if (event.type === 'invoice.payment_succeeded') {
      const invoiceId = event.metadata?.invoiceId;
      if (invoiceId && event.paymentIntentId) {
        await this.financialService.processPayment(invoiceId, event.paymentIntentId);
      } else {
        this.logger.warn('Missing invoiceId or paymentIntentId in payment event');
      }
    } else {
      await this.onboardingService.handleBillingWebhook(event);
    }

    return { received: true };
  }
}
