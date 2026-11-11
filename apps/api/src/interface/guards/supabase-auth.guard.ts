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
import { isAuthOutage, lookupUnavailable } from './guard-lookup';
import {
  authRejected,
  safeAuthErrorCode,
  tokenExpired,
} from './auth-rejected.exception';
import { ChapterGuard, prefetchChapterContext } from './chapter.guard';
import { PermissionsGuard } from './permissions.guard';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';

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
    const sessionCheck = this.supabase.auth.getUser(token);
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
        { roles: this.permissionsWillBeChecked(context) },
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

    request.supabaseUser = data.user;
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
   * Whether `PermissionsGuard` will read the caller's roles on this route: it
   * is on the route and the route requires a permission. Without a
   * requirement that guard returns before reading anything (attendance
   * check-in carries no `PermissionsGuard` at all), so prefetching roles
   * there would be a read nobody uses.
   */
  private permissionsWillBeChecked(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const guards = this.reflector.getAllAndMerge<unknown[]>(
      GUARDS_METADATA,
      targets,
    );
    if (!guards.includes(PermissionsGuard)) return false;
    return [PERMISSIONS_KEY, PERMISSIONS_ANY_KEY].some(
      (key) => this.reflector.getAllAndMerge<string[]>(key, targets).length > 0,
    );
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
