import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';
import { createHmac } from 'node:crypto';
import type { Response } from 'express';
import { getHeaderValue } from '../types/request-context.types';
import { constantTimeEquals } from '#domain/utils/constant-time';

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
   * Rate-limit buckets are keyed per authenticated user (Supabase JWT `sub`)
   * rather than per IP, so the limit follows a user across networks and is not
   * shared by everyone behind a single NAT/proxy.
   *
   * The throttler runs as the global `APP_GUARD`, *before* the
   * controller-scoped `SupabaseAuthGuard`, so `request.supabaseUser` is not yet
   * populated here. We read the subject from the bearer token directly — but
   * only after verifying its HS256 signature against `SUPABASE_JWT_SECRET`.
   * Verification is essential: without it a caller could mint tokens with a
   * rotating fake `sub` to land every request in a fresh bucket and evade the
   * limit entirely (and amplify the downstream `supabase.auth.getUser` call).
   * Requests without a valid, unexpired token fall back to per-IP keying, which
   * preserves the original denial-of-service protection. When the secret is not
   * configured, every request falls back to IP keying.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = this.verifiedUserId(req);
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
   * token on the request, or `null` (missing/invalid/expired token, or no
   * configured secret) so callers fall back to per-IP keying.
   */
  private verifiedUserId(req: Record<string, any>): string | null {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      return null;
    }

    const authHeader = getHeaderValue(
      (req.headers ?? {}) as Record<string, string | string[] | undefined>,
      'authorization',
    );
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const segments = authHeader.slice('Bearer '.length).split('.');
    if (segments.length !== 3) {
      return null;
    }
    const [headerSeg, payloadSeg, signatureSeg] = segments;

    try {
      const header = JSON.parse(
        Buffer.from(headerSeg, 'base64url').toString('utf8'),
      ) as { alg?: unknown };
      // Only HS256 is accepted; reject `none`/asymmetric algs (alg confusion).
      if (header.alg !== 'HS256') {
        return null;
      }

      const expected = createHmac('sha256', secret)
        .update(`${headerSeg}.${payloadSeg}`)
        .digest('base64url');
      if (!constantTimeEquals(signatureSeg, expected)) {
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(payloadSeg, 'base64url').toString('utf8'),
      ) as { sub?: unknown; exp?: unknown };
      // Require a numeric, unexpired `exp`: a verified Supabase token always
      // carries one, so a token without it is anomalous and must not yield a
      // perpetual per-user bucket.
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
    } catch {
      return null;
    }
  }
}
