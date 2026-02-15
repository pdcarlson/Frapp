import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import type { IBillingProvider } from '../../domain/adapters/billing.interface';
import { RequestWithHeaders } from '../auth.types';

@Injectable()
export class StripeWebhookGuard implements CanActivate {
  private readonly logger = new Logger(StripeWebhookGuard.name);

  constructor(
    @Inject(BILLING_PROVIDER)
    private readonly billingProvider: IBillingProvider,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const signature = request.headers['stripe-signature'];

    if (!signature) {
      this.logger.error('Missing stripe-signature header');
      throw new UnauthorizedException('Missing stripe-signature header');
    }

    const secret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured');
      throw new Error('Webhook secret not configured');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = request.body;
      const event = this.billingProvider.verifyWebhook(
        payload,
        signature,
        secret,
      );

      if (!event) {
        this.logger.warn('Received unhandled or invalid Stripe event type');
        return false;
      }

      // Attach normalized event to request for the controller
      request.billingEvent = event;
      return true;
    } catch (err) {
      this.logger.error('Stripe Webhook verification failed', err);
      throw new UnauthorizedException('Invalid signature');
    }
  }
}
