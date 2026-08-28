/**
 * Security-event records (issue #846, work-plan item 2).
 *
 * Three HTTP outcomes are security-relevant on their own, independent of any
 * exception: a rejected credential, a denied authorization, and a tripped rate
 * limit. `LoggingInterceptor` already logs *every* request at `log` level, which
 * is exactly why it cannot serve here — a denial is invisible in that stream.
 * These records are emitted at `warn` so a level filter alone isolates them.
 */

export const SECURITY_EVENT = 'security_event' as const;

export type SecurityEventKind =
  'auth_failure' | 'authorization_denied' | 'rate_limit_rejected';

/**
 * The status codes that produce a security event, and what each one means.
 *
 * Keyed by status because that is what the exception filter has in hand at the
 * one point every denial passes through, whichever guard raised it.
 */
export const SECURITY_EVENT_KINDS: Readonly<Record<number, SecurityEventKind>> =
  {
    401: 'auth_failure',
    403: 'authorization_denied',
    429: 'rate_limit_rejected',
  };

export function securityEventKind(
  statusCode: number,
): SecurityEventKind | undefined {
  return SECURITY_EVENT_KINDS[statusCode];
}

export interface SecurityEventInput {
  kind: SecurityEventKind;
  statusCode: number;
  method?: string;
  path?: string;
  requestId?: string;
  /** Raw user id, if the request got far enough to resolve one. */
  userId?: string;
  /** Raw chapter id, if one was in context. */
  chapterId?: string;
  /**
   * **Pseudonymized** origin — never a raw address. See `originHash` below.
   */
  originHash?: string;
  timestamp?: string;
}

export interface SecurityEventRecord {
  event: typeof SECURITY_EVENT;
  kind: SecurityEventKind;
  statusCode: number;
  method: string;
  path: string;
  requestId: string;
  userId?: string;
  chapterId?: string;
  originHash?: string;
  timestamp: string;
}

/**
 * Build the flat JSON record. One object per line, same convention as
 * `LoggingInterceptor` and the `push_delivery` record.
 *
 * **Why `originHash` and not `ip`.** The work plan asked for the IP.
 * `spec/behavior/observability.md` § Structured Logging says IPs are never
 * logged, and the spec wins. What an operator (or the spike rule below)
 * actually needs from an address is *stable grouping*, which the HMAC
 * preserves exactly — two requests from one origin share a digest, and the
 * address itself is nowhere on disk. The field is named for what it holds so
 * nobody later "fixes" it by substituting the raw value.
 *
 * `userId`/`chapterId` **are** raw here, and that is not an inconsistency: the
 * same spec section explicitly retains them in internal logs and pseudonymizes
 * them only at external boundaries. Sentry is such a boundary, and
 * `sentry-scrubbing.ts` hashes them on the way out.
 */
export function buildSecurityEvent(
  input: SecurityEventInput,
): SecurityEventRecord {
  return {
    event: SECURITY_EVENT,
    kind: input.kind,
    statusCode: input.statusCode,
    method: input.method ?? 'UNKNOWN',
    path: input.path ?? 'unknown',
    requestId: input.requestId ?? 'unknown',
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    ...(input.originHash ? { originHash: input.originHash } : {}),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
