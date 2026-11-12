import { randomBytes } from 'node:crypto';
import {
  AiTextCipherError,
  aiTextEnvelopeKeyId,
  openAiText,
  parseAiTextKeyRing,
  sealAiText,
} from './ai-text-cipher';

const key = () => randomBytes(32).toString('base64');

describe('ai-text-cipher', () => {
  const ring = parseAiTextKeyRing(`k2:${key()},k1:${key()}`);
  const context = 'ask-diagnostics:chapter-1';

  it('opens what it sealed, and the envelope holds none of the text', () => {
    const text = 'When is formal? Formal is April 17 at the boathouse.';
    const envelope = sealAiText(ring, text, context);
    expect(envelope).not.toContain('formal');
    expect(envelope.startsWith('v1.k2.')).toBe(true);
    expect(aiTextEnvelopeKeyId(envelope)).toBe('k2');
    expect(openAiText(ring, envelope, context)).toBe(text);
  });

  it('seals the same text differently each time', () => {
    expect(sealAiText(ring, 'same', context)).not.toBe(
      sealAiText(ring, 'same', context),
    );
  });

  it('still opens a value sealed by a key that has been rotated back', () => {
    const old = parseAiTextKeyRing(`k1:${ring![1].key.toString('base64')}`);
    const envelope = sealAiText(old, 'older row', context);
    expect(openAiText(ring, envelope, context)).toBe('older row');
  });

  it('refuses another context, an edited envelope and a dropped key', () => {
    const envelope = sealAiText(ring, 'text', context);
    const reason = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return (error as AiTextCipherError).reason;
      }
      return 'opened';
    };
    expect(
      reason(() => openAiText(ring, envelope, 'ask-diagnostics:chapter-2')),
    ).toBe('tampered');
    const parts = envelope.split('.');
    parts[4] = Buffer.from('other').toString('base64url');
    expect(reason(() => openAiText(ring, parts.join('.'), context))).toBe(
      'tampered',
    );
    expect(reason(() => openAiText(ring, 'not-an-envelope', context))).toBe(
      'malformed',
    );
    // A shortened tag is one an attacker could find by trying; only the
    // full 16 bytes this module writes are opened.
    const short = envelope.split('.');
    short[3] = Buffer.from(short[3], 'base64url')
      .subarray(0, 4)
      .toString('base64url');
    expect(reason(() => openAiText(ring, short.join('.'), context))).toBe(
      'malformed',
    );
    const without = parseAiTextKeyRing(`k9:${key()}`);
    expect(reason(() => openAiText(without, envelope, context))).toBe(
      'unknown_key',
    );
  });

  it('seals nothing without a key', () => {
    expect(parseAiTextKeyRing(undefined)).toBeNull();
    expect(parseAiTextKeyRing('  ')).toBeNull();
    expect(() => sealAiText(null, 'text', context)).toThrow(AiTextCipherError);
    expect(() => openAiText(null, 'v1.a.b.c.d', context)).toThrow(
      AiTextCipherError,
    );
  });

  it('fails loudly on a key that is set and wrong, without echoing it', () => {
    const short = Buffer.from('too short').toString('base64');
    expect(() => parseAiTextKeyRing(`k1:${short}`)).toThrow(/32 bytes/);
    expect(() => parseAiTextKeyRing(key())).toThrow(/<key id>/);
    expect(() => parseAiTextKeyRing(`K 1:${key()}`)).toThrow(/<key id>/);
    const same = key();
    expect(() => parseAiTextKeyRing(`k1:${same},k1:${same}`)).toThrow(/twice/);
    try {
      parseAiTextKeyRing(`k1:${short}`);
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
  });
});
