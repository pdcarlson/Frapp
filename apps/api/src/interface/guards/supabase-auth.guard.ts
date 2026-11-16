import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { RequestContext, getHeaderValue } from '../types/request-context.types';
import { VERIFY_SESSION_LOCALLY_KEY } from '../decorators/session-check.decorator';
import { JWKS_VERIFIED_ALGS } from './custom-throttler.guard';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { createHash } from 'node:crypto';
import { isAuthOutage, lookupUnavailable } from './guard-lookup';
import { InFlightLookups } from '../../infrastructure/supabase/in-flight-lookups';
import {
  requestReadsActive,
  sharesBurstLookups,
} from '../../infrastructure/supabase/request-reads';
import {
  authRejected,
  safeAuthErrorCode,
  tokenExpired,
} from './auth-rejected.exception';
import {
  ChapterGuard,
  prefetchAppUser,
  prefetchChapterContext,
  readAppUserId,
} from './chapter.guard';
import {
  AuthSyncInterceptor,
  hasSyncedSession,
} from '../interceptors/auth-sync.interceptor';

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

/**
 * The signing algorithms a token may carry to be verified locally (#5043):
 * the asymmetric ones `getClaims` checks against the project's JWKS, the
 * throttler's own set, since the local path needs the throttler to have
 * verified the token first. For any other (`HS256`, `none`, none at all)
 * `getClaims` would ask Auth instead, so such a token takes the `getUser` path
 * and is never accepted on its claims.
 */
const LOCALLY_VERIFIABLE_ALGS = JWKS_VERIFIED_ALGS;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What `getClaims` leaves unchecked on a token whose signature and expiry it
 * accepted (#5043): that this project issued it (`iss`) for a signed-in user
 * (`aud` and `role` `authenticated`, as `getUser` would require), and that it
 * names one (`sub`). Returns the first check that failed, or null. `exp` is
 * checked again so the answer never rests on the library alone, and so is
 * `alg`: `mayVerifyLocally` already admits only `LOCALLY_VERIFIABLE_ALGS`, so
 * `alg_not_allowed` is a backstop against a future caller, not a path the
 * guard takes today.
 */
export function failedClaimCheck(
  header: { alg?: unknown },
  claims: Record<string, unknown>,
  issuer: string,
  nowSeconds: number,
): string | null {
  if (
    typeof header.alg !== 'string' ||
    !LOCALLY_VERIFIABLE_ALGS.has(header.alg)
  ) {
    return 'alg_not_allowed';
  }
  if (claims.iss !== issuer) return 'iss_mismatch';
  const audiences: unknown[] = Array.isArray(claims.aud)
    ? claims.aud
    : [claims.aud];
  if (!audiences.includes('authenticated')) return 'aud_mismatch';
  if (claims.role !== 'authenticated') return 'role_mismatch';
  if (typeof claims.sub !== 'string' || !UUID_PATTERN.test(claims.sub)) {
    return 'bad_sub';
  }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    return 'expired';
  }
  return null;
}

/** The `alg` in a token's header, read without verifying anything. */
function tokenAlg(token: string): string | undefined {
  const [headerSeg] = token.split('.');
  if (!headerSeg) return undefined;
  try {
    const header = JSON.parse(
      Buffer.from(headerSeg, 'base64url').toString('utf8'),
    ) as { alg?: unknown };
    return typeof header.alg === 'string' ? header.alg : undefined;
  } catch {
    return undefined;
  }
}

/** The key `sessionLookups` shares a token's session check under. */
function sessionLookupKey(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  /**
   * The `iss` this project's Auth stamps on its tokens,
   * `<SUPABASE_URL>/auth/v1`. Undefined without a config (a stripped-down test
   * module), which turns the local path off: every request then calls
   * `getUser`.
   */
  private readonly issuer: string | undefined;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    private readonly reflector: Reflector,
    @Optional() config?: ConfigService,
  ) {
    const url = config?.get<string>('SUPABASE_URL');
    this.issuer = url ? `${url.replace(/\/+$/, '')}/auth/v1` : undefined;
  }

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

    // A read that opted in verifies the token here instead of asking Auth
    // (#5043, Paul 2026-11-16). Every other request, and every write, still
    // calls `getUser` below.
    if (this.mayVerifyLocally(context, request, token)) {
      // The chapter lookups start on the throttler's verified `sub` alongside
      // the verification, as they do alongside `getUser` below, so the route
      // keeps its one `get_request_context` call instead of reading the
      // user, membership and roles one after another. `verifyLocally`
      // refuses a token whose `sub` differs, and `ChapterGuard` uses what
      // they read only under the `sub` it accepted.
      const verified = request.throttlerVerifiedClaims as JwtPayload;
      prefetchChapterContext(
        this.supabase,
        verified.sub,
        verified,
        request.headers,
      );
      return this.verifyLocally(token, request);
    }

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
    // A route without `ChapterGuard` whose `AuthSyncInterceptor` resolves the
    // caller's `users` row gets that row's lookup started the same way
    // (`prefetchAppUser`, #3583), but only for a session the interceptor has
    // synced before: any other session waits on its sync, which reads the
    // row itself, so a prefetch would be a wasted read.
    const verified = request.throttlerVerifiedClaims;
    let prefetchedAppUser: Promise<string | null> | undefined;
    const chapterGuardFollows = this.chapterGuardFollows(context);
    const authSyncFollows =
      !chapterGuardFollows && this.authSyncFollows(context);
    if (typeof verified?.sub === 'string') {
      if (chapterGuardFollows) {
        prefetchChapterContext(
          this.supabase,
          verified.sub,
          verified,
          request.headers,
        );
      } else if (authSyncFollows && hasSyncedSession(verified.sub)) {
        prefetchedAppUser = prefetchAppUser(this.supabase, verified.sub);
      }
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
    if (authSyncFollows && requestReadsActive()) {
      // Under the id `getUser` returned: a prefetch made for any other `sub`
      // is not reused, and the lookup reads afresh instead.
      const authId = request.supabaseUser.id;
      const prefetched =
        verified?.sub === authId ? prefetchedAppUser : undefined;
      request.appUserLookup = prefetched
        ? () => prefetched
        : () => readAppUserId(this.supabase, authId);
    }
    return true;
  }

  /**
   * Whether this request may skip `getUser` (`@VerifySessionLocally()`): a
   * `GET` or `HEAD` to a handler that carries the marker, on a route
   * `ChapterGuard` also guards (it re-reads the `users` row and the
   * membership on every request, so a deleted user or removed member is still
   * refused at once), with a token signed by an asymmetric key that the
   * throttler has already verified. That last condition keeps the throttler's
   * bound on unknown signing keys: a token whose `kid` it would not send to
   * the JWKS verifier never reaches one from here either.
   */
  private mayVerifyLocally(
    context: ExecutionContext,
    request: RequestContext,
    token: string,
  ): boolean {
    if (!this.issuer) return false;
    const method = request.method?.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;
    const optedIn = this.reflector.get<boolean | undefined>(
      VERIFY_SESSION_LOCALLY_KEY,
      context.getHandler(),
    );
    if (optedIn !== true) return false;
    if (!this.chapterGuardFollows(context)) return false;
    if (typeof request.throttlerVerifiedClaims?.sub !== 'string') return false;
    const alg = tokenAlg(token);
    return alg !== undefined && LOCALLY_VERIFIABLE_ALGS.has(alg);
  }

  /**
   * Verifies the token against the project's JWKS (`getClaims`, cached) and
   * the claims `getClaims` leaves unchecked (`failedClaimCheck`). Fails
   * closed: a token that does not verify is a 401, and a verifier that could
   * not answer (the JWKS unreachable, a thrown error) is a 503, never a pass.
   */
  private async verifyLocally(
    token: string,
    request: RequestContext,
  ): Promise<boolean> {
    let answer: Awaited<ReturnType<FrappSupabaseClient['auth']['getClaims']>>;
    try {
      answer = await this.supabase.auth.getClaims(token);
    } catch (error) {
      throw lookupUnavailable('Could not verify your session right now', error);
    }
    const { data, error } = answer;
    if (error && isAuthOutage(error)) {
      throw lookupUnavailable('Could not verify your session right now', error);
    }
    const refuse = (check: string | undefined) =>
      authRejected('Invalid or expired token', 'claims_rejected', {
        authErrorCode: check,
        tokenExpired: tokenExpired(token),
      });
    if (error || !data?.claims) {
      throw refuse(safeAuthErrorCode(error?.code) ?? 'bad_jwt');
    }
    const claims = data.claims as Record<string, unknown>;
    const failed = failedClaimCheck(
      data.header,
      claims,
      this.issuer as string,
      Math.floor(Date.now() / 1000),
    );
    if (failed) throw refuse(failed);
    // The throttler verified this same token; a different `sub` here means
    // something is badly wrong, so it is refused rather than reasoned about.
    if (claims.sub !== request.throttlerVerifiedClaims?.sub) {
      throw refuse('sub_mismatch');
    }

    request.locallyVerifiedAuthId = claims.sub as string;
    request.jwtClaims = data.claims;
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

  /** Whether `AuthSyncInterceptor` runs on the route (`prefetchAppUser`). */
  private authSyncFollows(context: ExecutionContext): boolean {
    const interceptors = this.reflector.getAllAndMerge<unknown[]>(
      INTERCEPTORS_METADATA,
      [context.getHandler(), context.getClass()],
    );
    return interceptors.includes(AuthSyncInterceptor);
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
