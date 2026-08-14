import type { ErrorEvent } from '@sentry/nestjs';
import { hashUserIdForAnalytics, hmacSha256Hex } from '@repo/validation';
import { redactFreeText, scrubSentryEvent } from './sentry-scrubbing';

const SALT = 'test-salt-for-scrubbing';
const USER_UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const CHAPTER_UUID = '9e8d7c6b-5a49-4382-b716-05f4e3d2c1b0';

/**
 * `spec/behavior/observability.md` § Error Tracking is the contract under test:
 * user/chapter ids pseudonymized, and emails, IPs, tokens, bodies, and free-text
 * PII redacted — before anything leaves the process for Sentry.
 *
 * These assertions are deliberately phrased as "the raw value appears nowhere in
 * the serialized event" rather than "field X was deleted". A scrubber that
 * clears the field it knows about while the same value survives in a breadcrumb
 * has not done its job, and only the whole-payload assertion catches that.
 */
describe('scrubSentryEvent', () => {
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;

  beforeEach(() => {
    process.env.ANALYTICS_HMAC_SALT = SALT;
  });

  afterAll(() => {
    if (originalSalt === undefined) delete process.env.ANALYTICS_HMAC_SALT;
    else process.env.ANALYTICS_HMAC_SALT = originalSalt;
  });

  function serialize(event: ErrorEvent | null): string {
    return JSON.stringify(event);
  }

  it('drops the request body, cookies, and every non-allowlisted header', () => {
    const scrubbed = scrubSentryEvent({
      request: {
        method: 'POST',
        url: 'https://api.frapp.live/v1/chapters',
        headers: {
          authorization: 'Bearer sk_live_FAKEfixtureNOTREAL', // gitleaks:allow
          cookie: 'sb-access-token=secret-value',
          'content-type': 'application/json',
          'x-request-id': 'req-123',
          'x-forwarded-for': '203.0.113.7',
        },
        data: { password: 'hunter2', email: 'member@example.com' },
        cookies: { 'sb-refresh-token': 'another-secret' },
      },
    } as unknown as ErrorEvent);

    const out = serialize(scrubbed);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('member@example.com');
    expect(out).not.toContain('secret-value');
    expect(out).not.toContain('another-secret');
    expect(out).not.toContain('sk_live_FAKEfixtureNOTREAL'); // gitleaks:allow
    expect(out).not.toContain('203.0.113.7');

    expect(scrubbed?.request?.headers).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'req-123',
    });
    expect(scrubbed?.request?.method).toBe('POST');
    expect(scrubbed?.request).not.toHaveProperty('data');
    expect(scrubbed?.request).not.toHaveProperty('cookies');
  });

  it('strips the query string from request urls and transactions', () => {
    const scrubbed = scrubSentryEvent({
      transaction: 'GET /v1/reports?token=eyJhbGciOiJIUzI1NiJ9.abc.def', // gitleaks:allow
      request: {
        url: 'https://api.frapp.live/v1/reports?access_token=super-secret',
      },
    } as unknown as ErrorEvent);

    expect(scrubbed?.request?.url).toBe('https://api.frapp.live/v1/reports');
    expect(scrubbed?.transaction).toBe('GET /v1/reports');
    expect(serialize(scrubbed)).not.toContain('super-secret');
  });

  it('pseudonymizes uuids inside exception messages with the analytics salt', () => {
    const scrubbed = scrubSentryEvent({
      exception: {
        values: [
          {
            type: 'NotFoundException',
            value: `Chapter ${CHAPTER_UUID} not found for user ${USER_UUID}`,
          },
        ],
      },
    } as unknown as ErrorEvent);

    const message = scrubbed?.exception?.values?.[0]?.value ?? '';
    expect(message).not.toContain(USER_UUID);
    expect(message).not.toContain(CHAPTER_UUID);
    // The digest is the *same* one the tags carry, which is the whole point:
    // an operator can still tie the message to the tenant.
    expect(message).toContain(`[id:${hmacSha256Hex(SALT, USER_UUID)}]`);
    expect(message).toContain(`[id:${hmacSha256Hex(SALT, CHAPTER_UUID)}]`);
  });

  it('keeps a pseudonymous user id and discards anything else on user', () => {
    const pseudonym = hashUserIdForAnalytics(SALT, USER_UUID);

    const kept = scrubSentryEvent({
      user: {
        id: pseudonym,
        email: 'member@example.com',
        ip_address: '203.0.113.7',
        username: 'paul',
      },
    } as unknown as ErrorEvent);

    expect(kept?.user).toEqual({ id: pseudonym });
    const out = serialize(kept);
    expect(out).not.toContain('member@example.com');
    expect(out).not.toContain('203.0.113.7');
    expect(out).not.toContain('paul');
  });

  it('drops a raw uuid left on user.id rather than forwarding it', () => {
    const scrubbed = scrubSentryEvent({
      user: { id: USER_UUID },
    } as unknown as ErrorEvent);

    expect(scrubbed?.user).toBeUndefined();
    expect(serialize(scrubbed)).not.toContain(USER_UUID);
  });

  it('drops breadcrumb data and stack-frame locals', () => {
    const scrubbed = scrubSentryEvent({
      breadcrumbs: [
        {
          category: 'http',
          message: 'GET /v1/me?token=abc',
          data: { url: 'https://api.frapp.live/v1/me?token=abc' },
        },
      ],
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  filename: '/app/src/x.ts',
                  function: 'handler',
                  lineno: 12,
                  vars: { password: 'hunter2' },
                },
              ],
            },
          },
        ],
      },
    } as unknown as ErrorEvent);

    const out = serialize(scrubbed);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('token=abc');
    expect(scrubbed?.breadcrumbs?.[0]).not.toHaveProperty('data');
    expect(
      scrubbed?.exception?.values?.[0]?.stacktrace?.frames?.[0],
    ).not.toHaveProperty('vars');
    // Code identity survives — that is what makes the report useful.
    expect(
      scrubbed?.exception?.values?.[0]?.stacktrace?.frames?.[0]?.function,
    ).toBe('handler');
  });

  it('drops non-allowlisted top-level keys and contexts', () => {
    const scrubbed = scrubSentryEvent({
      level: 'error',
      extra: { requestBody: { ssn: '123-45-6789' } },
      contexts: {
        trace: { trace_id: 'abc' },
        state: { state: { password: 'hunter2' } },
      },
    } as unknown as ErrorEvent);

    const out = serialize(scrubbed);
    expect(out).not.toContain('123-45-6789');
    expect(out).not.toContain('hunter2');
    expect(scrubbed).not.toHaveProperty('extra');
    expect(scrubbed?.contexts).toEqual({ trace: { trace_id: 'abc' } });
    expect(scrubbed?.level).toBe('error');
  });

  it('redacts identifiers even when the salt is missing, never passing them through', () => {
    delete process.env.ANALYTICS_HMAC_SALT;

    const scrubbed = scrubSentryEvent({
      exception: {
        values: [
          { type: 'Error', value: `user ${USER_UUID} from 203.0.113.7` },
        ],
      },
    } as unknown as ErrorEvent);

    const out = serialize(scrubbed);
    expect(out).not.toContain(USER_UUID);
    expect(out).not.toContain('203.0.113.7');
    expect(out).toContain('[redacted:id]');
    expect(out).toContain('[redacted:ip]');
  });

  it('drops the event entirely if scrubbing throws', () => {
    const hostile = {
      get exception(): never {
        throw new Error('exploding getter');
      },
    };

    expect(scrubSentryEvent(hostile as unknown as ErrorEvent)).toBeNull();
  });
});

describe('redactFreeText', () => {
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;

  beforeEach(() => {
    process.env.ANALYTICS_HMAC_SALT = SALT;
  });

  afterAll(() => {
    if (originalSalt === undefined) delete process.env.ANALYTICS_HMAC_SALT;
    else process.env.ANALYTICS_HMAC_SALT = originalSalt;
  });

  it.each([
    ['Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', '[redacted:token]'],
    ['token eyJhbGciOiJIUzI1NiJ9.payload.sig', '[redacted:token]'],
    ['key sk_live_FAKEfixture0000', '[redacted:key]'], // gitleaks:allow
    ['whsec_abcdef123456789', '[redacted:key]'],
    ['mail to paul@frapp.live now', '[redacted:email]'],
  ])('redacts %j', (input, expected) => {
    expect(redactFreeText(input)).toContain(expected);
  });

  it('does not eat clock times as ipv6 addresses', () => {
    expect(redactFreeText('failed at 12:30:45 today')).toBe(
      'failed at 12:30:45 today',
    );
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Cannot read properties of undefined (reading "chapterId")';
    expect(redactFreeText(text)).toBe(text);
  });
});
