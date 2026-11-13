import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { RequestContext, getHeaderValue } from '../types/request-context.types';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { createHash } from 'node:crypto';
import { isAuthOutage, lookupUnavailable } from './guard-lookup';
import { InFlightLookups } from '../../infrastructure/supabase/in-flight-lookups';
import { sharesBurstLookups } from '../../infrastructure/supabase/request-reads';
import {
  authRejected,
  safeAuthErrorCode,
  tokenExpired,
} from './auth-rejected.exception';
import { ChapterGuard, prefetchChapterContext } from './chapter.guard';

/**
 * Process-wide: requests that arrive together with one token share one
 * `auth.getUser` (#3752, Paul 2026-11-13). An app open sends dozens of
 * requests at once, and each one's session check was its own call to Auth.
 * A joiner's answer can predate its request by up to
 * `IN_FLIGHT_JOIN_WINDOW_MS`, so a session revoked inside that window is still
 * accepted by the requests that joined. Keyed by a hash of the token, so the
 * map never holds one.
 */
const sessionLookups = new InFlightLookups<
  Awaited<ReturnType<FrappSupabaseClient['auth']['getUser']>>
>();

/** The key `sessionLookups` shares a token's session check under. */
export function sessionLookupKey(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const authHeader = getHeaderValue(request.headers, 'authorization');

    // Each refusal names its reason for the security record (#3907); the
    // response body is unchanged.
    if (!authHeader?.startsWith('Bearer ')) {
      throw authRejected(
        'Missing or invalid authorization header',
        'no_bearer',
      );
    }

    const token = authHeader.slice(7);

    // The session check is the slowest call a request makes (#3728). While it
    // is in flight, the chapter guard's lookups start on the `sub` the global
    // throttler already verified (`prefetchChapterContext`), so they no longer
    // queue behind it. Nothing they read is used unless this check passes for
    // that same user. No second verifier runs here: the throttler's is the one
    // that bounds unknown `kid`s (`custom-throttler.guard.ts`).
    // A read request may share it with the burst it arrived in (#3752); a
    // request that may write checks its own session.
    const checkSession = () => this.supabase.auth.getUser(token);
    const sessionCheck = sharesBurstLookups()
      ? sessionLookups.run(sessionLookupKey(token), checkSession)
      : checkSession();
    const verified = request.throttlerVerifiedClaims;
    if (
      typeof verified?.sub === 'string' &&
      this.chapterGuardFollows(context)
    ) {
      prefetchChapterContext(
        this.supabase,
        verified.sub,
        verified,
        request.headers,
      );
    }

    const { data, error } = await sessionCheck;

    // An Auth outage is not a verdict on the token (#3143): `isAuthOutage`.
    if (error && isAuthOutage(error)) {
      throw lookupUnavailable('Could not verify your session right now', error);
    }
    if (error || !data.user) {
      throw authRejected('Invalid or expired token', 'token_rejected', {
        authErrorCode: safeAuthErrorCode(error?.code),
        tokenExpired: tokenExpired(token),
      });
    }

    // A copy: the answer may be shared with other requests (`sessionLookups`).
    request.supabaseUser = structuredClone(data.user);
    request.jwtClaims = await this.readClaims(token);
    return true;
  }

  /**
   * Whether `ChapterGuard` runs after this guard on the route, so a prefetch
   * of its reads would be used. Routes such as `GET /v1/users/me` carry this
   * guard alone and would only pay for reads nobody makes.
   */
  private chapterGuardFollows(context: ExecutionContext): boolean {
    const guards = this.reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    return guards.includes(ChapterGuard);
  }

  /**
   * `getUser()` returns the *database* user record, so it never carries claims
   * added by `custom_access_token_hook` — the active chapter has to be read off
   * the token itself. `getClaims()` verifies locally against the project JWKS
   * (cached), which also covers the asymmetric ES256 keys Supabase now issues by
   * default; `SUPABASE_JWT_SECRET` would not verify those.
   *
   * Failure is deliberately non-fatal: `getUser()` above has already
   * authenticated the request, so a JWKS hiccup or a token predating the hook
   * should degrade to the `x-chapter-id` fallback that
   * spec/behavior/multi-tenancy.md sanctions, not reject a valid caller.
   */
  private async readClaims(token: string): Promise<JwtPayload | undefined> {
    try {
      const { data, error } = await this.supabase.auth.getClaims(token);
      return error ? undefined : (data?.claims ?? undefined);
    } catch {
      return undefined;
    }
  }
}
