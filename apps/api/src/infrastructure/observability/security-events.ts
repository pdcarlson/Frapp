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

/**
 * Which of the auth guard's 401s a failure was (#3907). An auth-failure spike
 * reads the same from outside whichever it is, and the fix differs:
 *
 *  - `no_bearer`: no `Authorization: Bearer …` header at all, so a client
 *    calling a guarded route signed out, or something that isn't our client.
 *  - `token_rejected`: a bearer token Supabase Auth refused, usually one that
 *    expired while a client kept using it.
 *
 * Any other 401 (the Stripe webhook's signature check) carries no reason.
 */
export type AuthFailureReason = 'no_bearer' | 'token_rejected';

/**
 * What the guard knew about a refused credential. Never the token, and never
 * anything from inside it but its expiry.
 */
export interface AuthFailureDetail {
  reason: AuthFailureReason;
  /**
   * Supabase Auth's error code for a `token_rejected` (`bad_jwt`,
   * `session_not_found`, `user_not_found`, …), when it sent a well-formed one.
   */
  authErrorCode?: string;
  /**
   * Whether the refused token's own `exp` had passed, read without verifying
   * it. Absent when there was no token or its payload didn't parse. A label,
   * not a verdict: Auth's refusal is the verdict.
   */
  tokenExpired?: boolean;
}

/** What a security record knows about the refusal and the client (#3907). */
export interface AuthFailureContext {
  /** Why a 401 was refused, when the guard said. */
  authFailure?: AuthFailureDetail;
  /** `mobile` or `web`, from what the client already sends (`requestApp`). */
  clientApp?: string;
  /** The mobile build, normalized by `clientVersionForLog`. */
  clientVersion?: string;
}

/**
 * That context as record fields, camelCase, each omitted when unknown. The one
 * builder every sink starts from: the JSON log records use it as is, and
 * {@link authFailureAttributes} renames it for PostHog and Sentry, so a new
 * field or a redaction lands once.
 */
export function authFailureFields(context: AuthFailureContext): {
  reason?: AuthFailureReason;
  authErrorCode?: string;
  tokenExpired?: boolean;
  clientApp?: string;
  clientVersion?: string;
} {
  const { authFailure, clientApp, clientVersion } = context;
  return {
    ...(authFailure ? { reason: authFailure.reason } : {}),
    ...(authFailure?.authErrorCode
      ? { authErrorCode: authFailure.authErrorCode }
      : {}),
    ...(authFailure?.tokenExpired !== undefined
      ? { tokenExpired: authFailure.tokenExpired }
      : {}),
    ...(clientApp ? { clientApp } : {}),
    ...(clientVersion ? { clientVersion } : {}),
  };
}

const ATTRIBUTE_NAMES = {
  reason: 'reason',
  authErrorCode: 'auth_error_code',
  tokenExpired: 'token_expired',
  clientApp: 'client_app',
  clientVersion: 'client_version',
} as const;

/** {@link authFailureFields} with the snake_case keys PostHog and Sentry use. */
export function authFailureAttributes(
  context: AuthFailureContext,
): Record<string, string | boolean> {
  const attributes: Record<string, string | boolean> = {};
  for (const [field, value] of Object.entries(authFailureFields(context))) {
    attributes[ATTRIBUTE_NAMES[field as keyof typeof ATTRIBUTE_NAMES]] = value;
  }
  return attributes;
}

export function securityEventKind(
  statusCode: number,
): SecurityEventKind | undefined {
  return SECURITY_EVENT_KINDS[statusCode];
}

export interface SecurityEventInput extends AuthFailureContext {
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
  reason?: AuthFailureReason;
  authErrorCode?: string;
  tokenExpired?: boolean;
  clientApp?: string;
  clientVersion?: string;
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
    ...authFailureFields(input),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
