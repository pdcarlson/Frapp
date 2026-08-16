import type { ErrorEvent } from '@sentry/nestjs';
import { hashUserIdForAnalytics, hmacSha256Hex } from '@repo/validation';
import {
  redactFreeText,
  scrubSentryEvent,
  scrubSentryTransaction,
} from './sentry-scrubbing';

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

  // Regression: an allowlist of context *names* alone let the trace context
  // through whole, and on an HTTP span its `description` is the route with the
  // query string still attached — reintroducing the leak `request.url` closes.
  it('scrubs the trace context rather than passing it through whole', () => {
    const scrubbed = scrubSentryEvent({
      contexts: {
        trace: {
          trace_id: 'abc123',
          span_id: 'def456',
          op: 'http.server',
          description: 'GET /v1/reports?access_token=super-secret',
          data: {
            'http.url':
              'https://api.frapp.live/v1/reports?access_token=super-secret',
            'url.query': 'access_token=super-secret',
          },
        },
      },
    } as unknown as ErrorEvent);

    const out = serialize(scrubbed);
    expect(out).not.toContain('super-secret');
    expect(out).not.toContain('access_token');

    const trace = scrubbed?.contexts?.trace as Record<string, unknown>;
    expect(trace).not.toHaveProperty('data');
    expect(trace.description).toBe('GET /v1/reports');
    // The parts that make the context useful survive.
    expect(trace.trace_id).toBe('abc123');
    expect(trace.op).toBe('http.server');
  });

  it('sweeps author-set fingerprints', () => {
    const scrubbed = scrubSentryEvent({
      fingerprint: [`chapter-${CHAPTER_UUID}`, 'static-part'],
    } as unknown as ErrorEvent);

    expect(serialize(scrubbed)).not.toContain(CHAPTER_UUID);
    expect(scrubbed?.fingerprint?.[1]).toBe('static-part');
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

/**
 * The transaction half of the same contract (#896).
 *
 * Transaction events reach Sentry through `beforeSendTransaction`, a hook the
 * SDK keeps separate from `beforeSend`. The assertions below are phrased the
 * same whole-payload way as the error-event ones above, plus one the error path
 * has no analogue for: **the span tree has to survive**. The plausible wrong fix
 * here — reusing `scrubSentryEvent` — still delivers every transaction, just
 * with `spans` silently dropped, so a test that only checked for absent PII
 * would pass while tracing was dead.
 */
describe('scrubSentryTransaction', () => {
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;

  beforeEach(() => {
    process.env.ANALYTICS_HMAC_SALT = SALT;
  });

  afterAll(() => {
    if (originalSalt === undefined) delete process.env.ANALYTICS_HMAC_SALT;
    else process.env.ANALYTICS_HMAC_SALT = originalSalt;
  });

  type Transaction = Parameters<typeof scrubSentryTransaction>[0];

  function transaction(overrides: Record<string, unknown>): Transaction {
    return {
      type: 'transaction',
      transaction: '/v1/chapters',
      ...overrides,
    } as unknown as Transaction;
  }

  it('keeps the span tree rather than dropping it', () => {
    const scrubbed = scrubSentryTransaction(
      transaction({
        spans: [
          {
            span_id: 'aaaa1111',
            parent_span_id: 'root0000',
            trace_id: 'trace123',
            start_timestamp: 1,
            timestamp: 2,
            op: 'db.query',
            status: 'ok',
            data: {},
          },
          {
            span_id: 'bbbb2222',
            trace_id: 'trace123',
            start_timestamp: 2,
            op: 'http.client',
            data: {},
          },
        ],
      }),
    );

    // The regression this whole separate scrubber exists to prevent.
    expect(scrubbed?.spans).toHaveLength(2);
    expect(scrubbed?.spans?.[0]).toMatchObject({
      span_id: 'aaaa1111',
      parent_span_id: 'root0000',
      trace_id: 'trace123',
      op: 'db.query',
      status: 'ok',
    });
    expect(scrubbed?.spans?.[1]).toMatchObject({ span_id: 'bbbb2222' });
  });

  it('emits no raw email, uuid, or ip from any part of a transaction', () => {
    const email = 'member@example.com';
    const ip = '203.0.113.7';

    const scrubbed = scrubSentryTransaction(
      transaction({
        transaction: `/v1/chapters/${CHAPTER_UUID}?notify=${email}`,
        request: {
          url: `https://api.frapp.live/v1/chapters?email=${email}`,
          method: 'GET',
          // `x-request-id` is on HEADER_ALLOWLIST *and* honoured from inbound
          // requests by request-id.middleware, so it is the header that proves
          // the value sweep. A non-allowlisted one would only prove the drop.
          headers: {
            'x-request-id': `retry-for-${email}`,
            'x-custom-note': `contact ${email} from ${ip}`,
          },
          query_string: `notify=${email}`,
          env: { REMOTE_ADDR: ip },
          cookies: { session: 'super-secret' },
          data: { body: email },
        },
        // Every real transaction carries this: the SDK builds contexts.trace
        // from the root span, and the root span is NOT in `spans`, so this bag
        // is the highest-volume PII surface on the whole event.
        contexts: {
          trace: {
            trace_id: 'trace123',
            span_id: 'root0000',
            op: 'http.server',
            status: 'ok',
            description: `GET /v1/chapters/${CHAPTER_UUID}?notify=${email}`,
            data: {
              'http.target': `/v1/chapters/${CHAPTER_UUID}?notify=${email}`,
              'http.url': `https://api.frapp.live/v1/chapters?email=${email}`,
              'client.address': ip,
              'http.request.method': 'GET',
              'http.response.status_code': 500,
            },
          },
        },
        tags: { note: `escalate to ${email}` },
        breadcrumbs: [{ message: `looked up ${email}` }],
        user: { id: USER_UUID, email, ip_address: ip },
        // Inherited onto the transaction allowlist from the error one, so they
        // are copied through by the key loop and are only safe because they are
        // rebuilt afterwards. `vars` is the sharpest edge — a snapshot of local
        // variables, i.e. arbitrary request payload.
        message: `checkout failed for ${email}`,
        exception: {
          values: [
            {
              type: 'Error',
              value: `no row for ${email} token=sk_live_FAKEfixtureNOTREAL`, // gitleaks:allow
              stacktrace: {
                frames: [{ filename: '/a.ts', vars: { pw: 'hunter2' } }],
              },
            },
          ],
        },
        measurements: { [`lookup ${email}`]: { value: 3, unit: 'none' } },
        spans: [
          {
            span_id: 'aaaa1111',
            trace_id: 'trace123',
            start_timestamp: 1,
            op: 'http.client',
            description: `GET /v1/members/${USER_UUID}?token=super-secret`,
            measurements: { [`rows for ${email}`]: { value: 1, unit: 'none' } },
            data: {
              'http.url': `https://api.frapp.live/v1/members?email=${email}`,
              'url.query': `email=${email}`,
              'db.statement': `select * from members where email = '${email}'`,
              'http.response.status_code': 200,
              // OTel permits array- and object-valued attributes; an
              // allowlisted key is no promise the value is a plain string.
              'http.request.method': ['GET', email],
              'db.system': { note: email },
            },
          },
        ],
      }),
    );

    const out = JSON.stringify(scrubbed);
    expect(out).not.toContain(email);
    expect(out).not.toContain(USER_UUID);
    expect(out).not.toContain(CHAPTER_UUID);
    expect(out).not.toContain(ip);
    expect(out).not.toContain('super-secret');
    expect(out).not.toContain('select * from members');
    expect(out).not.toContain('sk_live_FAKEfixtureNOTREAL'); // gitleaks:allow
    expect(out).not.toContain('hunter2');
    // A raw user id must not survive even as a pseudonym-shaped field.
    expect(scrubbed?.user).toBeUndefined();
    // Absence assertions alone are satisfied by dropping everything, which is
    // the "delivered but silently emptied" failure the span test guards. The
    // swept-but-surviving fields have to be pinned too.
    expect(scrubbed?.breadcrumbs?.[0]?.message).toBe(
      'looked up [redacted:email]',
    );
    expect(scrubbed?.tags?.note).toBe('escalate to [redacted:email]');
    expect(scrubbed?.spans).toHaveLength(1);
  });

  it('keeps the root span attributes that live only on contexts.trace', () => {
    // The counterpart to the assertion above: proving PII is gone is only half
    // the contract, because dropping the bag wholesale also passes that. The
    // root span is absent from `spans`, so if this is dropped the one span an
    // operator opens first has no method and no status code.
    const scrubbed = scrubSentryTransaction(
      transaction({
        contexts: {
          trace: {
            trace_id: 'trace123',
            span_id: 'root0000',
            op: 'http.server',
            data: {
              'http.request.method': 'GET',
              'http.response.status_code': 500,
              'http.url': 'https://api.frapp.live/v1/x?token=super-secret',
            },
          },
        },
      }),
    );

    const trace = scrubbed?.contexts?.trace as Record<string, unknown>;
    expect(trace.data).toEqual({
      'http.request.method': 'GET',
      'http.response.status_code': 500,
    });
    expect(JSON.stringify(scrubbed)).not.toContain('super-secret');
  });

  it('carries the dynamic sampling context the SDK reads back after the hook', () => {
    // `createEventEnvelopeHeaders` reads this *after* beforeSendTransaction
    // returns, so a rebuilt event that omits it silently costs every
    // transaction its `trace` envelope header. Only the routing fields survive
    // — the same bag holds `normalizedRequest`, a full request object.
    const scrubbed = scrubSentryTransaction(
      transaction({
        sdkProcessingMetadata: {
          dynamicSamplingContext: {
            trace_id: 'trace123',
            public_key: 'abc123',
            sample_rate: '0.1',
            environment: 'production',
            transaction: `/v1/chapters?notify=member@example.com`,
          },
          spanCountBeforeProcessing: 7,
          normalizedRequest: {
            url: 'https://api.frapp.live/v1/x?token=super-secret',
            headers: { cookie: 'session=super-secret' },
          },
        },
      }),
    );

    const meta = scrubbed?.sdkProcessingMetadata as Record<string, unknown>;
    expect(meta.dynamicSamplingContext).toEqual({
      trace_id: 'trace123',
      public_key: 'abc123',
      sample_rate: '0.1',
      environment: 'production',
      transaction: '/v1/chapters',
    });
    expect(meta.spanCountBeforeProcessing).toBe(7);
    expect(meta).not.toHaveProperty('normalizedRequest');
    expect(JSON.stringify(scrubbed)).not.toContain('super-secret');
  });

  it('sweeps dsc fields a caller can set through the baggage header', () => {
    // On a *continued* trace the DSC is parsed straight out of the inbound
    // `baggage` header and the SDK filters neither keys nor values, so
    // `release` and `environment` are caller-controlled free text that lands in
    // the envelope's `trace` header. Allowlisting a key is not a promise about
    // what is in it — the same lesson as `exception`/`message` one level down.
    const scrubbed = scrubSentryTransaction(
      transaction({
        sdkProcessingMetadata: {
          dynamicSamplingContext: {
            trace_id: 'trace123',
            public_key: 'abc123',
            environment: 'member@example.com',
            release: `note-for-member@example.com-${USER_UUID}`,
            sampled: 'true',
          },
        },
      }),
    );

    const dsc = (scrubbed?.sdkProcessingMetadata as Record<string, unknown>)
      .dynamicSamplingContext as Record<string, unknown>;
    expect(dsc.environment).toBe('[redacted:email]');
    expect(dsc.release).not.toContain('member@example.com');
    expect(dsc.release).not.toContain(USER_UUID);
    // Non-free-text routing fields are untouched.
    expect(dsc.trace_id).toBe('trace123');
    expect(dsc.sampled).toBe('true');
  });

  it('survives a malformed span without losing the whole transaction', () => {
    // `Object.entries(null)` throws, and the map runs inside the fail-closed
    // try — so an unguarded bad element would drop every good span with it.
    const scrubbed = scrubSentryTransaction(
      transaction({
        spans: [
          null,
          { span_id: 'good0001', trace_id: 't1', start_timestamp: 1, data: {} },
        ],
      }),
    );

    expect(scrubbed).not.toBeNull();
    expect(scrubbed?.spans).toHaveLength(2);
    expect(scrubbed?.spans?.[1]).toMatchObject({ span_id: 'good0001' });
  });

  it('drops non-allowlisted span attributes but keeps the safe ones', () => {
    const scrubbed = scrubSentryTransaction(
      transaction({
        spans: [
          {
            span_id: 'aaaa1111',
            trace_id: 'trace123',
            start_timestamp: 1,
            data: {
              'http.request.method': 'POST',
              'http.response.status_code': 500,
              'http.url': 'https://api.frapp.live/v1/x?token=super-secret',
              'url.query': 'token=super-secret',
              'db.statement': 'select 1',
            },
            links: [{ attributes: { note: 'member@example.com' } }],
          },
        ],
      }),
    );

    const data = scrubbed?.spans?.[0]?.data as Record<string, unknown>;
    expect(data).toEqual({
      'http.request.method': 'POST',
      'http.response.status_code': 500,
    });
    // `links` carries its own free-form attribute bag, so it goes by omission.
    expect(scrubbed?.spans?.[0]).not.toHaveProperty('links');
    expect(JSON.stringify(scrubbed)).not.toContain('super-secret');
  });

  it('strips the query string from the transaction name', () => {
    const scrubbed = scrubSentryTransaction(
      transaction({ transaction: '/v1/reports?access_token=super-secret' }),
    );

    expect(scrubbed?.transaction).toBe('/v1/reports');
  });

  it('drops non-allowlisted top-level keys but keeps tracing metadata', () => {
    const scrubbed = scrubSentryTransaction(
      transaction({
        spans: [],
        measurements: { lcp: { value: 12, unit: 'millisecond' } },
        transaction_info: { source: 'route' },
        start_timestamp: 1,
        server_name: 'api-1',
        breadcrumbs: [{ message: 'hello' }],
        // Not on the allowlist — an SDK or integration extra.
        somethingNew: 'leaky@example.com',
      }),
    );

    expect(scrubbed).not.toHaveProperty('somethingNew');
    expect(JSON.stringify(scrubbed)).not.toContain('leaky@example.com');
    expect(scrubbed).toMatchObject({
      type: 'transaction',
      measurements: { lcp: { value: 12, unit: 'millisecond' } },
      transaction_info: { source: 'route' },
      server_name: 'api-1',
    });
  });

  it('drops the transaction entirely if scrubbing throws', () => {
    const hostile = {
      type: 'transaction',
      get spans(): never {
        throw new Error('exploding getter');
      },
    };

    expect(
      scrubSentryTransaction(hostile as unknown as Transaction),
    ).toBeNull();
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
