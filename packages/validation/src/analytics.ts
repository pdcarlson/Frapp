/**
 * Pseudonymous analytics keying + payload hygiene.
 *
 * Shared by the API (server-originated events), apps/web, and apps/mobile so
 * that all three derive the *same* pseudonymous user key from the same inputs.
 * The raw `user_id` must never reach the analytics provider — events are keyed
 * by `hmac_sha256(salt, user_id)`. See `spec/behavior/data-retention.md`
 * (#analytics-events-pseudonymous).
 *
 * The HMAC is implemented in pure TypeScript on purpose: this module runs on
 * Node (server), the browser (web), and React Native (mobile), and a single
 * dependency-free implementation guarantees byte-identical output everywhere
 * with no `node:crypto` / `SubtleCrypto` platform branching. Verified against
 * the RFC 4231 HMAC-SHA-256 test vectors in `analytics.spec` (run in the API
 * Jest suite, which already imports `@repo/validation`).
 */

// ── SHA-256 (FIPS 180-4) over bytes ──────────────────────────────────────────

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const BLOCK_SIZE = 64; // bytes (512 bits)

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** SHA-256 digest of a byte array, returned as 32 raw bytes. */
function sha256(message: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  // Pre-processing: append 0x80, pad with zeros, append 64-bit big-endian length.
  const bitLength = message.length * 8;
  const paddedLength =
    Math.ceil((message.length + 9) / BLOCK_SIZE) * BLOCK_SIZE;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  // 64-bit length; high 32 bits handle messages > 512 MB without precision loss.
  const lengthHigh = Math.floor(bitLength / 0x100000000);
  const lengthLow = bitLength >>> 0;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLength - 8, lengthHigh, false);
  dv.setUint32(paddedLength - 4, lengthLow, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += BLOCK_SIZE) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => {
    outView.setUint32(index * 4, value, false);
  });
  return out;
}

// ── HMAC-SHA-256 (RFC 2104) ──────────────────────────────────────────────────

function utf8Bytes(value: string): Uint8Array {
  // TextEncoder is available on Node 18+, modern browsers, and React Native.
  return new TextEncoder().encode(value);
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * HMAC-SHA-256 of `message` under `key`, returned as a lowercase hex string.
 * Both inputs are UTF-8 encoded. Exported primarily for testability against the
 * RFC 4231 vectors; callers should prefer {@link hashUserIdForAnalytics}.
 */
export function hmacSha256Hex(key: string, message: string): string {
  let keyBytes = utf8Bytes(key);
  if (keyBytes.length > BLOCK_SIZE) {
    keyBytes = sha256(keyBytes);
  }

  const oKeyPad = new Uint8Array(BLOCK_SIZE);
  const iKeyPad = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const keyByte = keyBytes[i] ?? 0;
    oKeyPad[i] = keyByte ^ 0x5c;
    iKeyPad[i] = keyByte ^ 0x36;
  }

  const messageBytes = utf8Bytes(message);
  const inner = new Uint8Array(iKeyPad.length + messageBytes.length);
  inner.set(iKeyPad);
  inner.set(messageBytes, iKeyPad.length);
  const innerHash = sha256(inner);

  const outer = new Uint8Array(oKeyPad.length + innerHash.length);
  outer.set(oKeyPad);
  outer.set(innerHash, oKeyPad.length);

  return toHex(sha256(outer));
}

/**
 * Derive the pseudonymous analytics key for a user.
 *
 * `salt` is the per-environment secret held in the same secret store as other
 * credentials (never in the analytics provider's environment), and `userId` is
 * the raw Frapp user id. The returned hex digest is the only user identifier
 * that may be sent to the analytics provider.
 *
 * @throws if `salt` or `userId` is empty — a missing salt must fail loudly
 *   rather than silently keying every user under the empty-string salt.
 */
export function hashUserIdForAnalytics(salt: string, userId: string): string {
  if (!salt) {
    throw new Error('Analytics salt is required to key a user pseudonymously');
  }
  if (!userId) {
    throw new Error('userId is required to derive an analytics key');
  }
  return hmacSha256Hex(salt, userId);
}

/**
 * Derive the pseudonymous analytics key for a *chapter*.
 *
 * Funnel events are grouped by chapter (a chapter, not a user, is what
 * activates), so the provider needs a stable per-chapter key — but a raw
 * `chapter_id` is an identifier, and `spec/behavior/observability.md` already
 * fixes the rule for identifiers crossing an external boundary: *"`user_id` and
 * `chapter_id` are sent as HMAC-SHA256 hashes using the same per-environment
 * salt as the analytics pipeline."* This is that hash.
 *
 * Same salt and same construction as {@link hashUserIdForAnalytics} on purpose:
 * a chapter hashed here and the same chapter hashed at the error-reporting
 * boundary produce the same digest, so an operator can correlate a chapter
 * across providers without either one ever holding the raw id. User ids and
 * chapter ids are UUIDs drawn from disjoint tables, so sharing the salt cannot
 * collide one namespace onto the other.
 *
 * @throws if `salt` or `chapterId` is empty — same reasoning as the user hash.
 */
export function hashChapterIdForAnalytics(
  salt: string,
  chapterId: string,
): string {
  if (!salt) {
    throw new Error(
      'Analytics salt is required to key a chapter pseudonymously',
    );
  }
  if (!chapterId) {
    throw new Error('chapterId is required to derive an analytics key');
  }
  return hmacSha256Hex(salt, chapterId);
}

/**
 * Derive the pseudonymous observability key for a **request origin** (IP).
 *
 * `spec/behavior/observability.md` § Structured Logging is unconditional: IPs
 * are *never* logged. But a security event ("this origin has failed auth 20
 * times in 5 minutes") is worthless without a stable per-origin key, so the two
 * requirements only look like they conflict. What a spike rule needs is
 * *grouping*, not the address — and an HMAC gives grouping while leaving no
 * address anywhere in the logs.
 *
 * Same salt and construction as {@link hashUserIdForAnalytics}, for the same
 * reason given there: one operator-visible pseudonym per real-world entity,
 * correlatable across the log and error-reporting boundaries without either
 * side holding the raw value.
 *
 * Unlike the user and chapter hashes this one is **not** reversible even with
 * the salt in hand — a 32-bit IPv4 space is small enough to enumerate against a
 * known salt. That is a property to be aware of when handling the salt, not a
 * reason to skip the hash: an attacker who holds the salt has already lost you
 * the user and chapter pseudonyms too.
 *
 * @throws if `salt` or `ip` is empty — a missing salt must fail loudly rather
 *   than silently keying every origin under the empty-string salt. Callers that
 *   cannot guarantee a salt should omit the field entirely instead of passing
 *   `''` (see the API's security-event builder, which does exactly that).
 */
export function hashIpForObservability(salt: string, ip: string): string {
  if (!salt) {
    throw new Error(
      'Observability salt is required to key a request origin pseudonymously',
    );
  }
  if (!ip) {
    throw new Error('ip is required to derive an observability key');
  }
  return hmacSha256Hex(salt, ip);
}

// ── Activation funnel ────────────────────────────────────────────────────────

/**
 * The free-to-paid activation funnel (issue #267), in order.
 *
 * One vocabulary serves two consumers deliberately: each string is used
 * verbatim as both the `milestone` value stored in `chapter_activation_
 * milestones` and the analytics event name sent to the provider. A mapping
 * table between the two would be a second thing to keep in sync, and the
 * failure mode of it drifting is a funnel that silently stops matching.
 *
 * Ordering is the funnel's own — index is the step number, so conversion
 * between any two steps is `count(step N+1) / count(step N)`. The steps are
 * *not* strictly sequential for every chapter (a chapter can enable a paid
 * module before anyone redeems an invite), which is precisely what the funnel
 * is for measuring; the order encodes the intended path, not a state machine.
 *
 * Names are kebab-case to match the existing event examples on
 * {@link AnalyticsEvent} (`opened-channel`, `ran-slash-command`).
 *
 * Canonical behavior: `spec/behavior/observability.md` (#activation-funnel).
 */
export const ACTIVATION_MILESTONES = [
  /** The onboarding wizard was submitted and the chapter row exists. */
  'activation-onboarding-submitted',
  /** The chapter issued its first invite (link or batch). */
  'activation-first-invite-created',
  /** Someone other than the founder joined by redeeming an invite. */
  'activation-first-invite-redeemed',
  /** The first human-authored message was posted in any channel. */
  'activation-first-chat-message',
  /** A `tier: "paid"` module was switched on for the first time. */
  'activation-first-paid-module-enabled',
  /** A Stripe checkout session was created (intent to pay). */
  'activation-checkout-started',
  /** Stripe confirmed the checkout and the subscription went active. */
  'activation-checkout-completed',
] as const;

export type ActivationMilestone = (typeof ACTIVATION_MILESTONES)[number];

/** Step number (1-based) of a milestone within the funnel, for ordering. */
export function activationMilestoneStep(milestone: ActivationMilestone): number {
  return ACTIVATION_MILESTONES.indexOf(milestone) + 1;
}

// ── Payload hygiene ──────────────────────────────────────────────────────────

/**
 * Property keys that must never appear on an analytics event because they carry
 * content or PII rather than behavior. The check is conservative and
 * case-insensitive; it is the SDK-boundary backstop behind code review, not a
 * substitute for authors choosing behavioral properties.
 */
export const FORBIDDEN_ANALYTICS_PROPERTY_KEYS = [
  'content',
  'body',
  'message',
  'text',
  'transcript',
  'email',
  'name',
  'displayname',
  'phone',
  'address',
  'password',
  'token',
  'document',
  'attachment',
] as const;

/** Normalize a property key for comparison: lowercase, strip spaces/_/-. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '');
}

const FORBIDDEN_KEY_SET = new Set<string>(
  FORBIDDEN_ANALYTICS_PROPERTY_KEYS.map(normalizeKey),
);

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null
>;

export interface AnalyticsEvent {
  /** Behavioral event name, e.g. "opened-channel", "ran-slash-command". */
  name: string;
  /** Pseudonymous user key from {@link hashUserIdForAnalytics}. */
  distinctId: string;
  /** Behavioral, content-free properties. */
  properties?: AnalyticsProperties;
}

/**
 * Thrown when an analytics event carries content/PII. A distinct type so the
 * API boundary can map it to a 400 (caller error) while letting genuine server
 * faults surface as 500 instead of being masked.
 */
export class ContentFreePropertyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentFreePropertyError';
  }
}

/**
 * Throw if an event's properties look like content/PII. Rejects both forbidden
 * keys (email, body, …) and non-scalar values — a nested object or array could
 * smuggle content past the key check (e.g. `{ meta: { body: "…" } }`). Returns
 * the event unchanged on success so it can be used inline at the SDK boundary.
 */
export function assertContentFreeProperties(
  event: AnalyticsEvent,
): AnalyticsEvent {
  const properties = event.properties ?? {};

  const forbiddenKeys = Object.keys(properties).filter((key) =>
    FORBIDDEN_KEY_SET.has(normalizeKey(key)),
  );
  if (forbiddenKeys.length > 0) {
    throw new ContentFreePropertyError(
      `Analytics event "${event.name}" carries forbidden content/PII propert${
        forbiddenKeys.length === 1 ? 'y' : 'ies'
      }: ${forbiddenKeys.join(', ')}. Event properties must describe behavior, not content.`,
    );
  }

  const nonScalarKeys = Object.entries(properties)
    .filter(([, value]) => value !== null && typeof value === 'object')
    .map(([key]) => key);
  if (nonScalarKeys.length > 0) {
    throw new ContentFreePropertyError(
      `Analytics event "${event.name}" has non-scalar propert${
        nonScalarKeys.length === 1 ? 'y' : 'ies'
      }: ${nonScalarKeys.join(', ')}. Properties must be a string, number, boolean, or null — nested objects/arrays can smuggle content.`,
    );
  }

  return event;
}
