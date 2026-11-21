import { UnauthorizedException } from '@nestjs/common';
import { readUnverifiedJwtPayload } from '#domain/utils/jwt-segment';
import type {
  AuthFailureDetail,
  AuthFailureReason,
} from '../../infrastructure/observability/security-events';

/**
 * The auth guard's 401, carrying why it refused (#3907).
 *
 * The response is exactly the `UnauthorizedException` it extends: same status,
 * same message, no `code`. The detail is for `AllExceptionsFilter`, which puts
 * it on the `auth_failure` record and the spike report, so an auth-failure
 * spike names which refusal tripped it. Before this, every 401 read alike and a
 * spike could not tell a signed-out caller from a stale token.
 */
export class AuthRejectedException extends UnauthorizedException {
  constructor(
    message: string,
    readonly detail: AuthFailureDetail,
  ) {
    super(message);
  }
}

/**
 * The `message` of every 401 refusing a bearer token that was sent but is not
 * a live session: the auth guard's, and the throttler's when a rate limit
 * refuses a request whose token it found invalid (`custom-throttler.guard.ts`).
 * One string, so a client cannot tell the two apart and recovers the same way.
 */
export const INVALID_TOKEN_MESSAGE = 'Invalid or expired token';

/** The refusal detail, when `exception` is the auth guard's 401. */
export function authFailureDetail(
  exception: unknown,
): AuthFailureDetail | undefined {
  return exception instanceof AuthRejectedException
    ? exception.detail
    : undefined;
}

/**
 * Supabase Auth's error codes are short snake_case identifiers (`bad_jwt`,
 * `session_not_found`). Anything else is dropped rather than logged, so the
 * field can never carry free text from an upstream body.
 */
const AUTH_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

export function safeAuthErrorCode(code: unknown): string | undefined {
  return typeof code === 'string' && AUTH_ERROR_CODE.test(code)
    ? code
    : undefined;
}

/**
 * Whether a JWT's `exp` has passed, read from its payload **without
 * verifying it**. `undefined` when the token isn't a three-part JWT with a
 * numeric `exp`.
 *
 * Only ever a label on a token Auth has already refused: an expired token
 * that keeps arriving means a client isn't refreshing, while an unexpired one
 * Auth refuses means a revoked session or a deleted user.
 */
export function tokenExpired(
  token: string,
  now: number = Date.now(),
): boolean | undefined {
  const exp = readUnverifiedJwtPayload(token)?.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined;
  return exp * 1000 <= now;
}

export function authRejected(
  message: string,
  reason: AuthFailureReason,
  extra: Omit<AuthFailureDetail, 'reason'> = {},
): AuthRejectedException {
  return new AuthRejectedException(message, { reason, ...extra });
}
