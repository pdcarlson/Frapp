import type {
  User as SupabaseAuthUser,
  JwtPayload,
} from '@supabase/supabase-js';
import type { Request } from 'express';
import type { SubscriptionStatus } from '#domain/entities/chapter.entity';

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
  /**
   * The caller's Auth user as `auth.getUser` returned it, once
   * `SupabaseAuthGuard` has checked the session with Supabase Auth. Absent on
   * a read the guard verified locally (`locallyVerifiedAuthId`): read the
   * caller's id with `authUserIdOf`, and never treat this as always present.
   */
  supabaseUser?: SupabaseAuthUser;
  /**
   * Set by `SupabaseAuthGuard` instead of `supabaseUser` when it verified the
   * access token locally rather than asking Auth (#5043,
   * `@VerifySessionLocally()`): the token's `sub`, after its signature,
   * expiry, issuer, audience and role checked out. The session itself may
   * since have been signed out or revoked; spec/behavior/multi-tenancy.md
   * records that bound.
   */
  locallyVerifiedAuthId?: string;
  /**
   * Verified claims from the caller's access token, including the
   * `active_chapter_id` claim issued by `custom_access_token_hook`.
   * Undefined when the token could not be decoded locally — `ChapterGuard`
   * then falls back to the `x-chapter-id` header, which
   * spec/behavior/multi-tenancy.md explicitly allows for clients that have not
   * refreshed their token yet.
   */
  jwtClaims?: JwtPayload;
  /**
   * The claims of this request's bearer token, set by `CustomThrottlerGuard`
   * once it has verified the signature and `exp` (it runs first, as the
   * global guard). **Not authentication**: the session may still be revoked,
   * and only `SupabaseAuthGuard` decides that, with `getUser` or, on a read
   * marked `@VerifySessionLocally()` (#5043), by verifying the token again
   * itself. It lets that guard start the chapter lookups on a verified `sub`
   * while it checks (#3728), and its presence is a precondition of the local
   * check, which keeps that check inside the throttler's unknown-`kid` bound.
   * Absent when the
   * throttler skipped verification (an unknown `kid` within its retry
   * interval, no verifier for the `alg`, a route that skips throttling).
   */
  throttlerVerifiedClaims?: JwtPayload;
  appUser?: AppUserContext;
  /**
   * Set by `SupabaseAuthGuard`, once the session check has passed, on a route
   * with `AuthSyncInterceptor` and no `ChapterGuard` (#3583): the caller's
   * `users` row id for the `getUser` user. It answers with the lookup the
   * guard started while that check was in flight, when it started one for
   * this user; otherwise it reads when called, so a request that ends up
   * waiting on its sync makes no extra read. `null` for no row or a failed
   * read.
   */
  appUserLookup?: () => Promise<string | null>;
  member?: MemberContext;
  chapterId?: string;
  subscriptionStatus?: SubscriptionStatus;
  /**
   * `chapters.enabled_modules` as `ChapterGuard` read it. `null` is a chapter
   * with no toggles stored, which is every module on.
   */
  enabledModules?: Record<string, boolean> | null;
  rawBody?: Buffer;
}

export type WebhookRequest = RequestContext & {
  rawBody: Buffer;
};

/**
 * Name of the top-level access-token claim written by
 * `public.custom_access_token_hook` (see the migration of the same name).
 */
const ACTIVE_CHAPTER_CLAIM = 'active_chapter_id';

/**
 * Reads the active-chapter claim, tolerating tokens issued before the hook was
 * enabled (the claim is simply absent) and any non-string value.
 */
export function getActiveChapterClaim(
  claims: JwtPayload | undefined,
): string | undefined {
  const value: unknown = claims?.[ACTIVE_CHAPTER_CLAIM];
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

/**
 * Chapter id in context for routes that must not require ChapterGuard
 * (identity still works before a chapter is selected). JWT claim wins; the
 * `x-chapter-id` header is the unrefreshed-token fallback. A mismatch does
 * **not** 403 here — identity must still return the user pseudonym for Sentry.
 * Shape/HMAC validation lives in AnalyticsService, not this reader.
 */
export function getOptionalChapterId(
  request: Pick<RequestContext, 'chapterId' | 'jwtClaims' | 'headers'>,
): string | undefined {
  if (typeof request.chapterId === 'string' && request.chapterId.length > 0) {
    return request.chapterId;
  }
  const jwtChapterId = getActiveChapterClaim(request.jwtClaims);
  if (jwtChapterId) return jwtChapterId;
  return getHeaderValue(request.headers, 'x-chapter-id');
}

/**
 * The Auth user id `SupabaseAuthGuard` accepted for this request, whichever
 * way it checked the session (`supabaseUser` or `locallyVerifiedAuthId`), or
 * undefined before that guard has run.
 */
export function authUserIdOf(
  request: Pick<RequestContext, 'supabaseUser' | 'locallyVerifiedAuthId'>,
): string | undefined {
  return request.supabaseUser?.id ?? request.locallyVerifiedAuthId;
}
