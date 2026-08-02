import type {
  User as SupabaseAuthUser,
  JwtPayload,
} from '@supabase/supabase-js';
import type { Request } from 'express';
import type Stripe from 'stripe';
import type { SubscriptionStatus } from '../../domain/entities/chapter.entity';

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
  /**
   * Verified claims from the caller's access token, including the
   * `active_chapter_id` claim issued by `custom_access_token_hook`.
   * Undefined when the token could not be decoded locally — `ChapterGuard`
   * then falls back to the `x-chapter-id` header, which
   * spec/behavior/multi-tenancy.md explicitly allows for clients that have not
   * refreshed their token yet.
   */
  jwtClaims?: JwtPayload;
  appUser?: AppUserContext;
  member?: MemberContext;
  chapterId?: string;
  subscriptionStatus?: SubscriptionStatus;
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

/**
 * Name of the top-level access-token claim written by
 * `public.custom_access_token_hook` (see the migration of the same name).
 */
export const ACTIVE_CHAPTER_CLAIM = 'active_chapter_id';

/**
 * Reads the active-chapter claim, tolerating tokens issued before the hook was
 * enabled (the claim is simply absent) and any non-string value.
 */
export function getActiveChapterClaim(
  claims: JwtPayload | undefined,
): string | undefined {
  const value = claims?.[ACTIVE_CHAPTER_CLAIM];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

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
