import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { RequestContext, getHeaderValue } from '../types/request-context.types';

@Injectable()
export class StripeWebhookGuard implements CanActivate {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'));
    this.webhookSecret = config.getOrThrow('STRIPE_WEBHOOK_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const signature = getHeaderValue(request.headers, 'stripe-signature');

    if (!signature) {
      throw new UnauthorizedException('Missing Stripe signature');
    }

    if (!request.rawBody) {
      throw new UnauthorizedException('Missing raw request body');
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
