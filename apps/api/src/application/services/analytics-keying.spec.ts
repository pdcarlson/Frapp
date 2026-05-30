import { createHmac } from 'node:crypto';
import {
  assertContentFreeProperties,
  hashUserIdForAnalytics,
  hmacSha256Hex,
} from '@repo/validation';

/** Authoritative oracle for the UTF-8 string interface the clients use. */
function nodeHmac(key: string, message: string): string {
  return createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(Buffer.from(message, 'utf8'))
    .digest('hex');
}

/**
 * Pins the shared analytics keying util (`@repo/validation`) so the API, web,
 * and mobile all derive identical pseudonyms. Lives in the API Jest suite
 * because that already runs `@repo/validation` in CI.
 */
describe('analytics keying util', () => {
  describe('hmacSha256Hex — RFC 4231 HMAC-SHA-256 vectors', () => {
    // Test Case 1: key = 0x0b*20, data = "Hi There".
    it('matches RFC 4231 test case 1', () => {
      const key = '\x0b'.repeat(20);
      expect(hmacSha256Hex(key, 'Hi There')).toBe(
        'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
      );
    });

    // Test Case 2: key = "Jefe", data = "what do ya want for nothing?".
    it('matches RFC 4231 test case 2', () => {
      expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      );
    });

    // The clients hash UTF-8 strings, so cross-check the string interface
    // against node:crypto across edge cases the RFC byte vectors can't express:
    // a key longer than the 64-byte block (forces key hashing) and multi-byte
    // Unicode in both key and message.
    it.each([
      ['short-salt', 'user-1'],
      ['k'.repeat(65), 'long-key-triggers-key-hashing'],
      ['per-env-salt-éxample', 'user-with-unicode-名前-😀'],
      ['', ''],
    ])('matches node:crypto for key=%p message=%p', (key, message) => {
      expect(hmacSha256Hex(key, message)).toBe(nodeHmac(key, message));
    });

    it('is deterministic for the same inputs', () => {
      expect(hmacSha256Hex('salt', 'user-1')).toBe(
        hmacSha256Hex('salt', 'user-1'),
      );
    });

    it('produces different digests for different salts (cannot rainbow-table without the salt)', () => {
      expect(hmacSha256Hex('salt-a', 'user-1')).not.toBe(
        hmacSha256Hex('salt-b', 'user-1'),
      );
    });
  });

  describe('hashUserIdForAnalytics', () => {
    it('returns a 64-char lowercase hex digest', () => {
      const digest = hashUserIdForAnalytics('per-env-salt', 'user-123');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('never returns the raw user id', () => {
      const digest = hashUserIdForAnalytics('per-env-salt', 'user-123');
      expect(digest).not.toContain('user-123');
    });

    it('throws when the salt is empty', () => {
      expect(() => hashUserIdForAnalytics('', 'user-1')).toThrow(/salt/i);
    });

    it('throws when the user id is empty', () => {
      expect(() => hashUserIdForAnalytics('salt', '')).toThrow(/userId/i);
    });
  });

  describe('assertContentFreeProperties', () => {
    it('passes behavioral properties through unchanged', () => {
      const event = {
        name: 'opened-channel',
        distinctId: 'abc',
        properties: { channel_kind: 'announcements', is_admin: true },
      };
      expect(assertContentFreeProperties(event)).toBe(event);
    });

    it('rejects content-bearing keys (message body)', () => {
      expect(() =>
        assertContentFreeProperties({
          name: 'sent-message',
          distinctId: 'abc',
          properties: { body: 'secret text' },
        }),
      ).toThrow(/forbidden/i);
    });

    it('rejects PII keys case- and separator-insensitively (Display Name)', () => {
      expect(() =>
        assertContentFreeProperties({
          name: 'edited-profile',
          distinctId: 'abc',
          properties: { 'Display Name': 'Jane' },
        }),
      ).toThrow(/display/i);
    });

    it('allows an event with no properties', () => {
      expect(() =>
        assertContentFreeProperties({ name: 'app-opened', distinctId: 'abc' }),
      ).not.toThrow();
    });
  });
});
