import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '../types/request-context.types';
import { pathOnly } from './path-only';
import { httpStatusClass } from '../../infrastructure/analytics/http-status-class';
import { enqueueSanitizedLog } from '../../infrastructure/analytics/posthog-runtime';
import {
  pseudonymizeChapterId,
  pseudonymizeUserId,
} from '../../infrastructure/observability/pseudonyms';

/**
 * Shape of the `X-Forwarded-For` chain, carrying no address.
 *
 * `spec/behavior/observability.md` § Structured Logging forbids logging IP
 * addresses unconditionally, so this records only what is needed to choose an
 * Express `trust proxy` hop count (#864). The addresses themselves are compared
 * in process and never emitted.
 */
export interface ForwardedShape {
  /**
   * Entries in `x-forwarded-for`; `0` when the header is absent or empty.
   *
   * This is the field that determines the hop count: probe with a known number
   * of forged entries and subtract, and the remainder is what the proxies in
   * front actually appended.
   */
  xffCount: number;
  /**
   * Whether the socket peer *also* appears as the chain's final entry.
   *
   * Normally `false`, and that is not a problem: each proxy appends the peer it
   * received from, so the nearest proxy's own address is the one address the
   * chain does not contain. It does **not** discriminate a one-hop chain from a
   * two-hop one — `xffCount` does that. A `true` here flags a non-standard
   * chain (something echoing its own address) and means the count should be
   * sanity-checked before `trust proxy` is set from it.
   */
  xffSocketIsLast: boolean;
}

/** Strips the IPv4-mapped IPv6 prefix so `::ffff:1.2.3.4` compares equal to `1.2.3.4`. */
function normalizeAddress(value: string): string {
  const lower = value.trim().toLowerCase();
  return lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower;
}

export function forwardedShape(request: Partial<Request>): ForwardedShape {
  // Read the header directly rather than `req.ips`, which Express leaves empty
  // until `trust proxy` is set — the very setting this exists to inform. Also
  // not `getHeaderValue`, which takes only the first value of a repeated header
  // and would undercount a chain split across several `X-Forwarded-For` lines.
  const header = request.headers?.['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const socket = request.socket?.remoteAddress;
  const last = entries[entries.length - 1];

  return {
    xffCount: entries.length,
    xffSocketIsLast:
      last !== undefined &&
      socket !== undefined &&
      normalizeAddress(last) === normalizeAddress(socket),
  };
}

/**
 * Express sets `request.route` only after a handler matched. Unmatched
 * `/v1/…` 404s never enter `LoggingInterceptor`, so the exception filter uses
 * this to decide whether it must emit the sanitized request log itself (#2078).
 */
export function hasMatchedExpressRoute(request: RequestContext): boolean {
  return request.route !== undefined;
}

/**
 * One stdout JSON request record plus one sanitized PostHog Logs row.
 *
 * Shared by `LoggingInterceptor` (matched routes) and `AllExceptionsFilter`
 * (unmatched 4xx). `latencyMs` is omitted when the caller has no start time —
 * unmatched routes never entered the interceptor, so there is none.
 */
export function emitSanitizedHttpRequestLog(
  logger: Logger,
  request: RequestContext,
  statusCode: number | undefined,
  latencyMs?: number,
): void {
  const status = statusCode ?? 500;
  const { xffCount, xffSocketIsLast } = forwardedShape(request);
  const path = pathOnly(request.url);
  const requestId = request.requestId ?? 'unknown';

  logger.log(
    JSON.stringify({
      requestId: request.requestId,
      userId: request.appUser?.id,
      chapterId: request.chapterId,
      method: request.method,
      // `request.url` carries the query string, which routinely carries
      // credentials — the Discord connect callback's `state` IS the CSRF
      // token (#1260). This field was never specified — § Structured
      // Logging said "endpoint" — so rule 1 there, added with this fix,
      // is what requires it to route through `pathOnly`.
      path,
      statusCode: status,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      xffCount,
      xffSocketIsLast,
      timestamp: new Date().toISOString(),
    }),
  );

  const userHash = pseudonymizeUserId(request.appUser?.id);
  const chapterHash = pseudonymizeChapterId(request.chapterId);
  enqueueSanitizedLog(
    {
      body: 'request',
      severity: status >= 500 ? 'ERROR' : 'INFO',
      attributes: {
        request_id: requestId,
        method: request.method ?? 'UNKNOWN',
        path: path ?? '/',
        status_code: status,
        status_class: httpStatusClass(status),
        ...(latencyMs !== undefined ? { latency_ms: latencyMs } : {}),
        ...(userHash ? { user_hash: userHash } : {}),
        ...(chapterHash ? { chapter_hash: chapterHash } : {}),
      },
    },
    request.requestId ?? `${request.method}:${path}:${status}`,
  );
}
