import { ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';
import { createHmac } from 'node:crypto';
import type { Response } from 'express';
import { getHeaderValue } from '../types/request-context.types';
import { constantTimeEquals } from '#domain/utils/constant-time';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

/**
 * Signature algorithms verified against the project's JWKS. Supabase signs
 * with ES256 by default on every project created since asymmetric signing
 * keys shipped, and both hosted Frapp projects are on it (`HS256` is
 * `previously_used` on each). RS256 is the other key type the dashboard can
 * issue. Anything else — `none`, a HMAC alg with a JWKS-shaped header — is
 * refused before any verifier sees it.
 */
const JWKS_VERIFIED_ALGS: ReadonlySet<string> = new Set(['ES256', 'RS256']);

/**
 * Methods counted against the `read` bucket; everything else is a `write`.
 * Exported so tests derive the expected bucket from the same set the guard
 * uses, rather than from a copy that could drift away from it.
 */
export const READ_THROTTLE_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  /**
   * Property-injected, and optional, on purpose. `ThrottlerGuard`'s own
   * constructor takes the throttler options, storage and `Reflector`, and a
   * subclass constructor would have to restate all three injections to add a
   * fourth; a property keeps the base wiring untouched. Optional because the
   * guard must still construct where no Supabase client is provided (the unit
   * tests, a stripped-down module) — it then degrades to the HS256 path and
   * per-IP keying exactly as before.
   */
  @Optional()
  @Inject(SUPABASE_CLIENT)
  private readonly supabase?: FrappSupabaseClient;

  /**
   * Rate-limit buckets are keyed per authenticated user (Supabase JWT `sub`)
   * rather than per IP, so the limit follows a user across networks and is not
   * shared by everyone behind a single NAT/proxy — a chapter house on one
   * Wi-Fi is one public address, and 100 reads a minute shared across thirty
   * members opening the app is a 429 for all of them.
   *
   * The throttler runs as the global `APP_GUARD`, *before* the
   * controller-scoped `SupabaseAuthGuard`, so `request.supabaseUser` is not yet
   * populated here. We read the subject from the bearer token directly — but
   * only after verifying its signature. Verification is essential: without it
   * a caller could mint tokens with a rotating fake `sub` to land every request
   * in a fresh bucket and evade the limit entirely (and amplify the downstream
   * `supabase.auth.getUser` call). Two verifiers, chosen by the token's `alg`:
   *
   * - **HS256** — checked locally against `SUPABASE_JWT_SECRET`. Kept for a
   *   project that still signs symmetrically (an older CLI, a self-hosted
   *   GoTrue); no Frapp project does today.
   * - **ES256 / RS256** — checked with `supabase.auth.getClaims()`, which
   *   verifies against the project's JWKS with WebCrypto and caches the key set,
   *   so after the first fetch it is a local signature check, not a network
   *   round trip. Both hosted Frapp projects sign ES256 (`HS256` is
   *   `previously_used` on each) and so does the local stack the pinned CLI
   *   starts, so before this path existed no request anywhere was keyed per
   *   user — the secret would not have verified those tokens even if it had
   *   been set, and `SupabaseAuthGuard` says as much about its own
   *   `getClaims()` call.
   *
   * Requests without a valid, unexpired token fall back to per-IP keying, which
   * preserves the original denial-of-service protection.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = await this.verifiedUserId(req);
    if (userId) {
      return `user:${userId}`;
    }
    const ips = Array.isArray(req.ips) ? (req.ips as unknown[]) : [];
    const ip: unknown = ips.length > 0 ? ips[0] : (req.ip as unknown);
    return `ip:${String(ip)}`;
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context, throttler } = requestProps;
    const request = context.switchToHttp().getRequest<{ method?: string }>();
    const method = request.method?.toUpperCase() ?? '';
    const isReadMethod = READ_THROTTLE_METHODS.has(method);

    if (throttler.name === 'write' && isReadMethod) {
      return true;
    }

    if (throttler.name === 'read' && !isReadMethod) {
      return true;
    }

    return super.handleRequest(requestProps);
  }

  /**
   * Emit a standard, unsuffixed `Retry-After` header (in seconds) on 429s.
   * Because we register *named* throttlers (`read`/`write`), the base guard
   * only sets a name-suffixed header (`Retry-After-read` / `Retry-After-write`)
   * that HTTP clients do not honour, so we add the canonical one here.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    res.header('Retry-After', String(throttlerLimitDetail.timeToBlockExpire));
    await super.throwThrottlingException(context, throttlerLimitDetail);
  }

  /**
   * Return the `sub` of a cryptographically verified, unexpired Supabase access
   * token on the request, or `null` (missing/malformed/invalid/expired token,
   * or no verifier available for its `alg`) so callers fall back to per-IP
   * keying.
   */
  private async verifiedUserId(
    req: Record<string, any>,
  ): Promise<string | null> {
    const authHeader = getHeaderValue(
      (req.headers ?? {}) as Record<string, string | string[] | undefined>,
      'authorization',
    );
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.slice('Bearer '.length);
    const segments = token.split('.');
    if (segments.length !== 3) {
      return null;
    }
    const [headerSeg, payloadSeg, signatureSeg] = segments;

    let alg: unknown;
    try {
      alg = (
        JSON.parse(Buffer.from(headerSeg, 'base64url').toString('utf8')) as {
          alg?: unknown;
        }
      ).alg;
    } catch {
      return null;
    }

    if (alg === 'HS256') {
      return this.hs256Subject(headerSeg, payloadSeg, signatureSeg);
    }
    if (typeof alg === 'string' && JWKS_VERIFIED_ALGS.has(alg)) {
      return this.jwksSubject(token);
    }
    // `none`, an unknown alg, or no alg at all: nothing here can verify it.
    return null;
  }

  /**
   * HS256 — the local Supabase stack's algorithm — verified against
   * `SUPABASE_JWT_SECRET`. Without the secret there is no way to check the
   * signature, so the token yields no subject rather than an unverified one.
   */
  private hs256Subject(
    headerSeg: string,
    payloadSeg: string,
    signatureSeg: string,
  ): string | null {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      return null;
    }

    const expected = createHmac('sha256', secret)
      .update(`${headerSeg}.${payloadSeg}`)
      .digest('base64url');
    if (!constantTimeEquals(signatureSeg, expected)) {
      return null;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(payloadSeg, 'base64url').toString('utf8'),
      ) as { sub?: unknown; exp?: unknown };
      return subjectOfUnexpired(payload);
    } catch {
      return null;
    }
  }

  /**
   * ES256 / RS256 — verified by supabase-js against the project JWKS (cached
   * after the first fetch; WebCrypto locally thereafter). `getClaims` already
   * rejects a bad signature and an expired token, and the `exp` re-check below
   * is the same belt the HS256 path wears: a claims object with no usable
   * `exp` must not become a perpetual per-user bucket. Any failure — no client
   * wired, JWKS unreachable on a cold start, verification error — is a `null`
   * and therefore per-IP keying, never a rejected request: this guard limits
   * rates, `SupabaseAuthGuard` decides authentication.
   */
  private async jwksSubject(token: string): Promise<string | null> {
    if (!this.supabase) {
      return null;
    }
    try {
      const { data, error } = await this.supabase.auth.getClaims(token);
      if (error || !data?.claims) {
        return null;
      }
      return subjectOfUnexpired(data.claims);
    } catch {
      return null;
    }
  }
}

/**
 * The `sub` of a payload whose `exp` is numeric and still in the future, else
 * `null`. A verified Supabase token always carries `exp`; one without it is
 * anomalous and gets no bucket of its own.
 */
function subjectOfUnexpired(payload: {
  sub?: unknown;
  exp?: unknown;
}): string | null {
  if (
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    payload.exp * 1000 <= Date.now()
  ) {
    return null;
  }
  return typeof payload.sub === 'string' && payload.sub.length > 0
    ? payload.sub
    : null;
}
