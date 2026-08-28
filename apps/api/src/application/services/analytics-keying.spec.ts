import { createHmac } from 'node:crypto';
import {
  ACTIVATION_MILESTONES,
  activationMilestoneStep,
  assertContentFreeProperties,
  hashChapterIdForAnalytics,
  hashIpForObservability,
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

    it('rejects non-scalar values that could smuggle content (nested object)', () => {
      expect(() =>
        assertContentFreeProperties({
          name: 'opened-channel',
          distinctId: 'abc',
          properties: {
            meta: { body: 'hidden' } as unknown as string,
          },
        }),
      ).toThrow(/non-scalar/i);
    });

    it('rejects array values', () => {
      expect(() =>
        assertContentFreeProperties({
          name: 'opened-channel',
          distinctId: 'abc',
          properties: { tags: ['a', 'b'] as unknown as string },
        }),
      ).toThrow(/non-scalar/i);
    });

    it('allows an event with no properties', () => {
      expect(() =>
        assertContentFreeProperties({ name: 'app-opened', distinctId: 'abc' }),
      ).not.toThrow();
    });
  });

  describe('hashChapterIdForAnalytics', () => {
    it('returns a 64-char lowercase hex digest', () => {
      expect(hashChapterIdForAnalytics('salt', 'chapter-1')).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });

    it('never returns the raw chapter id', () => {
      const digest = hashChapterIdForAnalytics('salt', 'chapter-1');
      expect(digest).not.toContain('chapter-1');
    });

    // observability.md promises "the same per-environment salt as the analytics
    // pipeline", so a chapter hashed here must equal the same chapter hashed at
    // any other boundary using that salt — otherwise operators cannot correlate.
    it('agrees with the raw HMAC under the same salt', () => {
      expect(hashChapterIdForAnalytics('salt', 'chapter-1')).toBe(
        nodeHmac('salt', 'chapter-1'),
      );
    });

    it('throws when the salt is empty', () => {
      expect(() => hashChapterIdForAnalytics('', 'chapter-1')).toThrow(/salt/i);
    });

    it('throws when the chapter id is empty', () => {
      expect(() => hashChapterIdForAnalytics('salt', '')).toThrow(/chapterId/);
    });
  });

  describe('hashIpForObservability (#846)', () => {
    it('returns a 64-char lowercase hex digest', () => {
      expect(hashIpForObservability('salt', '203.0.113.7')).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });

    it('never returns the raw address', () => {
      expect(hashIpForObservability('salt', '203.0.113.7')).not.toContain(
        '203.0.113.7',
      );
    });

    // Grouping is the only property the spike rule needs from an address, and
    // it is exactly what survives the hash.
    it('is stable for one origin and distinct across origins', () => {
      const a = hashIpForObservability('salt', '203.0.113.7');
      expect(hashIpForObservability('salt', '203.0.113.7')).toBe(a);
      expect(hashIpForObservability('salt', '203.0.113.8')).not.toBe(a);
    });

    // Same construction as the user/chapter hashes, so an operator can pivot
    // between a security log line and a Sentry event on one digest.
    it('agrees with the raw HMAC under the same salt', () => {
      expect(hashIpForObservability('salt', '203.0.113.7')).toBe(
        nodeHmac('salt', '203.0.113.7'),
      );
    });

    it('throws when the salt is empty', () => {
      expect(() => hashIpForObservability('', '203.0.113.7')).toThrow(/salt/i);
    });

    it('throws when the ip is empty', () => {
      expect(() => hashIpForObservability('salt', '')).toThrow(/ip/);
    });
  });

  describe('activation funnel vocabulary (#267)', () => {
    it('has seven milestones, all kebab-case and unique', () => {
      expect(ACTIVATION_MILESTONES).toHaveLength(7);
      expect(new Set(ACTIVATION_MILESTONES).size).toBe(7);
      for (const milestone of ACTIVATION_MILESTONES) {
        expect(milestone).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    // Every name is also a DB `milestone` value constrained by a CHECK, so an
    // edit here without the matching migration would be rejected at write time.
    it('numbers steps 1..7 in declaration order', () => {
      expect(
        ACTIVATION_MILESTONES.map((m) => activationMilestoneStep(m)),
      ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('carries no property that the content/PII guard would reject', () => {
      for (const milestone of ACTIVATION_MILESTONES) {
        expect(() =>
          assertContentFreeProperties({
            name: milestone,
            distinctId: 'abc',
            properties: { step: activationMilestoneStep(milestone) },
          }),
        ).not.toThrow();
      }
    });
  });
});
