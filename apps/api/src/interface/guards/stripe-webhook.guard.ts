import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeWebhookGuard implements CanActivate {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'));
    this.webhookSecret = config.getOrThrow('STRIPE_WEBHOOK_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['stripe-signature'];

    if (!signature) {
      throw new UnauthorizedException('Missing Stripe signature');
    }

    try {
      const event = this.stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        this.webhookSecret,
      );
      request.stripeEvent = event;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid Stripe signature');
    }
  }
}
