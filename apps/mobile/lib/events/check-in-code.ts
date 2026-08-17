/**
 * The QR payload contract between the host display (s22) and the member
 * scanner (s18).
 *
 * The string is minted server-side by `mintCheckInToken`
 * (`apps/api/src/domain/utils/check-in-token.ts`) and rendered verbatim by s22,
 * so there is exactly one place that *builds* it. This module only parses, and
 * pins the prefix in a test — the same approach C1 used for the `chat:channel:`
 * topic string, because the two halves live in different workspaces and nothing
 * in the type system connects them.
 *
 * Parsing locally rather than posting every scanned string to the server is the
 * point: a camera pointed at a room reads receipts, posters, and other apps'
 * codes constantly, and each one would otherwise be a network round trip and a
 * failed check-in.
 */

/** Must match `CHECK_IN_QR_PREFIX` in the API. Versioned so an old scanner
 * rejects a future format instead of mis-reading it. */
export const CHECK_IN_QR_PREFIX = "frapp-checkin:v1";

export interface ScannedCheckInCode {
  eventId: string;
  token: string;
}

/**
 * Parse a scanned barcode, or return `null` for anything that is not one of our
 * check-in codes.
 *
 * `split` with a limit is wrong here — a base64url token contains no colons,
 * but relying on that would make the parser fragile against a format change.
 * Splitting off the two known leading segments and keeping the remainder whole
 * survives a token that ever gains one.
 */
export function parseCheckInCode(raw: string): ScannedCheckInCode | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value.startsWith(`${CHECK_IN_QR_PREFIX}:`)) return null;

  const rest = value.slice(CHECK_IN_QR_PREFIX.length + 1);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;

  const eventId = rest.slice(0, separator);
  const token = rest.slice(separator + 1);
  if (!eventId || !token) return null;

  return { eventId, token };
}

/**
 * Whether a typed string is plausibly a manual code, used only to enable the
 * submit control. The server is the authority on validity — this must never
 * grow into a client-side check of whether a code is *correct*, which it cannot
 * know without the signing secret.
 */
export function isPlausibleManualCode(input: string): boolean {
  return input.replace(/[^0-9A-Za-z]/g, "").length === 5;
}
