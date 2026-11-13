import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for the two places Frapp keeps AI text
 * (`spec/behavior/ai.md` § Stored AI text, ADR-28 decision 8): a reported
 * exchange (#4315) and the beta diagnostics window on Ask.
 *
 * AES-256-GCM with a fresh 96-bit nonce per value. The stored envelope names
 * the key that sealed it, so a key can be rotated: add the new key first in
 * `AI_STORED_TEXT_KEY`, keep the old one behind it until every row it sealed
 * has aged out (30 days at most), then drop it.
 *
 * The envelope is text: `v1.<key id>.<nonce>.<tag>.<ciphertext>`, the last
 * three in base64url. `context` is bound in as additional authenticated
 * data, so a row's ciphertext cannot be moved to another row (or another
 * table) and still open: pass something that names the row's owner, such as
 * `ask-diagnostics:<chapter id>`.
 *
 * With no key configured nothing can be sealed, and a caller must then store
 * nothing: there is no plaintext fallback.
 */

const ENVELOPE_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface AiTextKey {
  id: string;
  key: Buffer;
}

/** The keys this process holds. The first one seals; all of them open. */
export type AiTextKeyRing = readonly AiTextKey[];

export class AiTextCipherError extends Error {
  constructor(
    readonly reason: 'no_key' | 'unknown_key' | 'malformed' | 'tampered',
  ) {
    // No part of the value or the key is ever in the message.
    super(`AI stored text: ${reason}`);
    this.name = 'AiTextCipherError';
  }
}

/**
 * Parses a key ring setting (`AI_STORED_TEXT_KEY` unless `name` says
 * otherwise; `GOOGLE_CALENDAR_TOKEN_KEY` uses the same format and cipher):
 * `<key id>:<base64 of 32 bytes>`, with older
 * keys after it separated by commas. Returns null when the value is unset or
 * blank, and throws (naming the fault, never the value) when it is set and
 * wrong, so a typo fails at boot instead of silently storing nothing.
 */
export function parseAiTextKeyRing(
  value: string | null | undefined,
  name = 'AI_STORED_TEXT_KEY',
): AiTextKeyRing | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const ring: AiTextKey[] = [];
  for (const part of trimmed.split(',')) {
    const separator = part.indexOf(':');
    const id = part.slice(0, separator).trim();
    const key = Buffer.from(part.slice(separator + 1).trim(), 'base64');
    if (separator < 1 || !KEY_ID.test(id)) {
      throw new Error(
        `${name}: each key is "<key id>:<base64 key>", the id lowercase letters, digits, "-" or "_"`,
      );
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `${name}: key "${id}" must be ${KEY_BYTES} bytes, base64 encoded`,
      );
    }
    if (ring.some((existing) => existing.id === id)) {
      throw new Error(`${name}: key id "${id}" appears twice`);
    }
    ring.push({ id, key });
  }
  return ring;
}

export function sealAiText(
  ring: AiTextKeyRing | null,
  plaintext: string,
  context: string,
): string {
  const current = ring?.[0];
  if (!current) throw new AiTextCipherError('no_key');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, current.key, nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const sealed = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [
    ENVELOPE_VERSION,
    current.id,
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    sealed.toString('base64url'),
  ].join('.');
}

export function openAiText(
  ring: AiTextKeyRing | null,
  envelope: string,
  context: string,
): string {
  if (!ring?.length) throw new AiTextCipherError('no_key');
  const parts = envelope.split('.');
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION) {
    throw new AiTextCipherError('malformed');
  }
  const [, keyId, nonce, tag, sealed] = parts;
  const key = ring.find((candidate) => candidate.id === keyId);
  if (!key) throw new AiTextCipherError('unknown_key');
  const nonceBytes = Buffer.from(nonce, 'base64url');
  const tagBytes = Buffer.from(tag, 'base64url');
  // GCM accepts a shortened tag unless told not to, and a 4-byte tag can be
  // forged by trying; only the full tag this module writes is opened.
  if (nonceBytes.length !== NONCE_BYTES || tagBytes.length !== TAG_BYTES) {
    throw new AiTextCipherError('malformed');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key.key, nonceBytes, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(sealed, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AiTextCipherError('tampered');
  }
}

/** The id of the key an envelope was sealed with, to tell when a key can go. */
export function aiTextEnvelopeKeyId(envelope: string): string | null {
  const parts = envelope.split('.');
  return parts.length === 5 && parts[0] === ENVELOPE_VERSION ? parts[1] : null;
}
