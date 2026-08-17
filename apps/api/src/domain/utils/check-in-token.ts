import { createHmac } from 'node:crypto';
import { constantTimeEquals } from './constant-time';

/**
 * Rotating event check-in tokens (`spec/ui/mobile/patterns.md` § QR check-in).
 *
 * The host screen (s22) displays a server-signed token that rotates every 30
 * seconds; the member scanner (s18) redeems it. This is a **signed nonce**
 * scheme, not TOTP — there is no shared secret on member devices, so nothing a
 * member holds can mint a code.
 *
 * ## "Single-use" means single-use *per member*
 *
 * `patterns.md` says the token is "single-use on redemption". Read literally that
 * would let exactly one member check in per window, because one host code is by
 * construction scanned by everyone in the room at once. It means one redemption
 * per member, which the unique `(event_id, user_id)` index already enforces
 * inside the `check_in_event` RPC via `on conflict do nothing` — a concurrent
 * double check-in inserts nothing and returns 409 without a double points award
 * (`spec/behavior/events.md`). So there is deliberately **no redemption ledger
 * here**: adding one would be a second, weaker copy of a guarantee the database
 * already makes atomically.
 *
 * ## Why the token carries no window index
 *
 * A token is the signature alone, and verification recomputes the expected
 * signature for the current and previous window. The obvious alternative —
 * embedding the window index so the server knows which one to check — hands the
 * attacker a field they control and makes replay protection depend on
 * remembering to bound it. Trying both windows costs one extra HMAC and removes
 * that class of bug structurally.
 *
 * Accepting the previous window is required, not lax: a scan that races a
 * rotation must still land (`patterns.md`).
 */

/** Rotation period. `patterns.md` specifies ~30 seconds. */
export const CHECK_IN_TOKEN_WINDOW_MS = 30_000;

/**
 * Crockford base32 — no `I`, `L`, `O` or `U`, so the manual fallback code can be
 * read off a screen and typed without the 1/I/L and 0/O confusions. `U` is
 * excluded by the alphabet's design to avoid accidental obscenities.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The QR payload prefix. Mobile pins this exact string in a spec — see
 * `apps/mobile/lib/events/check-in-code.ts`. Versioned so a future format change
 * is detectable by an old scanner rather than silently mis-parsed. */
export const CHECK_IN_QR_PREFIX = 'frapp-checkin:v1';

export function currentCheckInWindow(nowMs: number): number {
  return Math.floor(nowMs / CHECK_IN_TOKEN_WINDOW_MS);
}

function sign(eventId: string, windowIndex: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${eventId}.${windowIndex}`)
    .digest('base64url');
}

/**
 * The short code a member types when their camera fails (s22 "Show code: 4KQ-88").
 *
 * Three base32 characters plus two digits — 32³ × 100 ≈ 3.3M values per 30-second
 * window. That is not brute-forceable inside a window against the API's write
 * throttle (30 requests / 60s), which is what makes a code this short acceptable;
 * it is a usability affordance riding on the rate limiter, not an independent
 * secret.
 */
export function checkInManualCode(
  eventId: string,
  windowIndex: number,
  secret: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`manual.${eventId}.${windowIndex}`)
    .digest();

  const letters =
    CROCKFORD[digest[0] % 32] +
    CROCKFORD[digest[1] % 32] +
    CROCKFORD[digest[2] % 32];
  const digits = String(digest[3] % 100).padStart(2, '0');

  return `${letters}-${digits}`;
}

/**
 * Normalize typed input before comparison: case, whitespace, and the Crockford
 * substitutions (`I`/`L` → `1`, `O` → `0`) a member is likely to enter after
 * reading the code off a screen. Punctuation is dropped and the dash reinserted,
 * so `4kq88`, `4KQ 88` and `4KQ-88` all resolve to the same code.
 */
export function normalizeManualCode(input: string): string {
  const cleaned = input
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '');

  if (cleaned.length !== 5) return cleaned;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
}

export interface MintedCheckInToken {
  token: string;
  manualCode: string;
  qrPayload: string;
  /** ISO timestamp at which this token stops being the *current* one. It stays
   * redeemable for one further window as the previous token. */
  expiresAt: string;
  /** Milliseconds until rotation, so the host screen can draw its countdown
   * without re-deriving the window boundary. */
  rotatesInMs: number;
}

export function mintCheckInToken(
  eventId: string,
  secret: string,
  nowMs: number,
): MintedCheckInToken {
  const windowIndex = currentCheckInWindow(nowMs);
  const token = sign(eventId, windowIndex, secret);
  const endOfWindowMs = (windowIndex + 1) * CHECK_IN_TOKEN_WINDOW_MS;

  return {
    token,
    manualCode: checkInManualCode(eventId, windowIndex, secret),
    qrPayload: `${CHECK_IN_QR_PREFIX}:${eventId}:${token}`,
    expiresAt: new Date(endOfWindowMs).toISOString(),
    rotatesInMs: endOfWindowMs - nowMs,
  };
}

/**
 * Verify a scanned token or a typed manual code against the current and previous
 * windows.
 *
 * Both candidates are always evaluated — the `|| matched` ordering keeps the
 * comparison itself unconditional rather than short-circuiting after the first
 * hit, so the work done does not depend on *which* window matched.
 */
export function verifyCheckInToken(
  token: string,
  eventId: string,
  secret: string,
  nowMs: number,
): boolean {
  const current = currentCheckInWindow(nowMs);
  let matched = false;
  for (const windowIndex of [current, current - 1]) {
    matched =
      constantTimeEquals(token, sign(eventId, windowIndex, secret)) || matched;
  }
  return matched;
}

export function verifyManualCode(
  code: string,
  eventId: string,
  secret: string,
  nowMs: number,
): boolean {
  const normalized = normalizeManualCode(code);
  const current = currentCheckInWindow(nowMs);
  let matched = false;
  for (const windowIndex of [current, current - 1]) {
    matched =
      constantTimeEquals(
        normalized,
        checkInManualCode(eventId, windowIndex, secret),
      ) || matched;
  }
  return matched;
}
