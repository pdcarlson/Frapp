import {
  Controller,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  Headers,
  Inject,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BillingService } from '../../application/services/billing.service';
import {
  BILLING_PROVIDER,
  type IBillingProvider,
} from '../../domain/adapters/billing.interface';
import type { WebhookRequest } from '../types/request-context.types';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly billingService: BillingService,
    @Inject(BILLING_PROVIDER)
    private readonly billingProvider: IBillingProvider,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Stripe webhook events' })
  async handleStripeWebhook(
    @Req() req: WebhookRequest,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException(
        'Raw body not available. Ensure rawBody parsing is enabled.',
      );
    }

    let event;
    try {
      event = this.billingProvider.constructWebhookEvent(rawBody, signature);
    } catch (error) {
      this.logger.warn(
        `Stripe webhook signature verification failed: ${error instanceof Error ? error.message : error}`,
      );
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }

    await this.billingService.handleWebhookEvent(event);

    return { received: true };
  }
}
