/**
 * Reading a JWT's parts **without verifying anything**: one base64url segment
 * decoded to UTF-8 and parsed as JSON. What a caller may trust from the
 * answer is its own business: the throttler reads the payload only after it
 * has checked the signature, and the other readers use it only as a label or
 * a hint (`tokenExpired`, `classifySupabaseKey`, the auth guard's `alg`, the
 * Google ID token's email).
 */

/**
 * The JSON value one JWT segment encodes, or `undefined` when it isn't JSON.
 * JSON has no `undefined`, so that answer never stands for a decoded value;
 * a segment that encodes `null`, a number or an array comes back as is.
 */
export function decodeJwtSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * The payload of a three-part JWT, unverified, or `undefined` when `token`
 * isn't three parts or its payload isn't a JSON object (an array counts as
 * one, as `typeof` has it).
 */
export function readUnverifiedJwtPayload(
  token: string,
): Record<string, unknown> | undefined {
  const segments = token.split('.');
  if (segments.length !== 3) return undefined;
  const payload = decodeJwtSegment(segments[1]);
  return payload !== null && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : undefined;
}
