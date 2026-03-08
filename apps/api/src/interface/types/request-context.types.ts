import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { Request } from 'express';
import type Stripe from 'stripe';

export interface AppUserContext {
  id: string;
  [key: string]: unknown;
}

export interface MemberContext {
  id: string;
  role_ids: string[];
  user_id?: string;
  chapter_id?: string;
  [key: string]: unknown;
}

export interface RequestContext extends Request {
  requestId?: string;
  supabaseUser?: SupabaseAuthUser;
  appUser?: AppUserContext;
  member?: MemberContext;
  chapterId?: string;
  rawBody?: Buffer;
  stripeEvent?: Stripe.Event;
}

export type AuthenticatedRequest = RequestContext & {
  supabaseUser: SupabaseAuthUser;
};

export type ChapterScopedRequest = AuthenticatedRequest & {
  appUser: AppUserContext;
  member: MemberContext;
  chapterId: string;
};

export type WebhookRequest = RequestContext & {
  rawBody: Buffer;
};

export function getHeaderValue(
  headers: Request['headers'],
  key: string,
): string | undefined {
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
