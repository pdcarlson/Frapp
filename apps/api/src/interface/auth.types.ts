import { Request } from 'express';
import { IncomingHttpHeaders } from 'http';
import { BillingEvent } from '../domain/adapters/billing.interface';

export interface RequestWithHeaders extends Request {
  headers: IncomingHttpHeaders & {
    authorization?: string;
    'x-chapter-id'?: string;
    'svix-id'?: string;
    'svix-timestamp'?: string;
    'svix-signature'?: string;
    'stripe-signature'?: string;
  };
  billingEvent?: BillingEvent;
}

export interface RequestWithUser extends RequestWithHeaders {
  user: {
    sub: string;
    [key: string]: any;
  };
}
