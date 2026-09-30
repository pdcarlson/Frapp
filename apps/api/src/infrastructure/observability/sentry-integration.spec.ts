import { ServiceUnavailableException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';
import Stripe from 'stripe';
import { buildSentryOptions } from './sentry-options';
import { scrubSentryEvent } from './sentry-scrubbing';

/**
 * End-to-end wiring test for the **real** Sentry SDK (issue #682).
 *
 * Every other Sentry spec in this repo stubs the SDK: `sentry-scrubbing.spec.ts`
 * calls `scrubSentryEvent` as a plain function, and
 * `all-exceptions.filter.spec.ts` opens with `jest.mock('@sentry/nestjs')`. Both
 * are the right shape for what they test, but between them nothing ever asks the
 * installed SDK whether the API's `Sentry.init` options are still honoured — so
 * a major-version bump could silently stop invoking `beforeSend` and every
 * existing test would stay green while the API shipped unscrubbed PII.
 *
 * Three construction choices, each fixing a way an earlier draft of this file
 * managed to pass while proving nothing:
 *
 *  - **Options come from {@link buildSentryOptions}**, the same function
 *    `main.ts` calls. A draft that re-declared them locally made its PII
 *    assertion (then `sendDefaultPii`) a tautology reading back its own
 *    literal, and would have stayed green while production flipped it.
 *
 *  - **Assertions read what reached the transport**, not what `beforeSend`
 *    returned. `beforeSend` is passed through untouched from production, so
 *    this observes the shipped envelope. A draft that wrapped `beforeSend` to
 *    record its return value could not distinguish "scrubber dropped the
 *    event" from "scrubber was never called", and a scrubber mutated to drop
 *    every message event — every auth-failure-spike alert — left it fully
 *    green.
 *
 *  - **PII is asserted against `exception.values[0].value`**, never the
 *    serialized event. The `ContextLines` integration attaches ~7 source lines
 *    around each frame, so a draft asserting `JSON.stringify(event)` contained
 *    `'[redacted:email]'` was satisfied by the echo of its own assertion line.
 *
 * It is hermetic by construction: the stubbed transport means no envelope can
 * leave the process and the `.invalid` DSN is never resolved, on any runner.
 *
 * **Scope of "production options", stated precisely.** `dsn`, `environment`,
 * `dataCollection`, `traceLifecycle` and both `beforeSend*` hooks come from the
 * builder and are what the assertions below exercise. `tracesSampleRate`
 * (forced to 1 so the transaction test is deterministic), `transport`,
 * `integrations` and `defaultIntegrations` are overridden here, so this file
 * would *not* notice production adding any of the last three — the default integration set leaks a
 * test environment per worker (`jest --detectLeaks` fails), and a real
 * transport would defeat hermeticity.
 *
 * `contextLines` is pinned because it is what makes source text reach the
 * payload, which several assertions below have to work around.
 * `localVariablesIntegration` is absent for a narrower reason than it may
 * appear: it does cover caught exceptions (`captureAllExceptions` defaults to
 * `true`), but it attaches nothing unless `includeLocalVariables` is set — the
 * API does not set it — and it needs the debugger to pause on a *thrown*
 * error, which `captureException(new Error(...))` never does. So a `vars`
 * assertion here would pass with `scrubFrame`'s allowlist omitted, making it
 * worse than no test. That rule is covered where it can actually fail — the
 * `@repo/observability` scrubber spec and this directory's `sentry-scrubbing.spec.ts`
 * build a frame carrying `vars` by hand and assert it does not survive. **Do not read that as the
 * rule being dead:** `LocalVariablesAsync` ships in production's default
 * integration set. `dataCollection.stackFrameVariables: false` now tells it
 * to attach nothing, but that is one SDK setting, so the scrubber rule stays
 * the backstop if `includeLocalVariables` is ever enabled for debugging.
 *
 * This file is a wiring test, not a scrubber test. The per-rule coverage
 * (`user` rejection, contexts, request, breadcrumbs, fail-closed) lives in
 * `sentry-scrubbing.spec.ts`, which can construct the event shapes needed to
 * make each rule fail; several of those rules cannot be made to fail from
 * here, so passing this file alone is not evidence the scrubber is intact.
 */

/** Well-formed but deliberately unroutable — `.invalid` is reserved (RFC 2606). */
const FIXTURE_DSN = 'https://fixturekey@o0.ingest.example.invalid/1';
const SALT = 'test-salt-for-integration';
const USER_UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('Sentry SDK integration', () => {
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;
  /** Event payloads as the transport received them — i.e. what would ship. */
  let sent: ErrorEvent[] = [];
  /** Transaction payloads, likewise. */
  let sentTransactions: Record<string, unknown>[] = [];

  beforeAll(() => {
    process.env.ANALYTICS_HMAC_SALT = SALT;

    Sentry.init({
      // Spread verbatim: `beforeSend` is production's, unwrapped, so a `null`
      // return still drops the event exactly as it does in the API.
      ...buildSentryOptions(FIXTURE_DSN),
      // Every span sampled, so the transaction test below is deterministic.
      // The production rate is asserted against the builder further down.
      tracesSampleRate: 1,
      defaultIntegrations: false,
      integrations: [
        Sentry.contextLinesIntegration(),
        Sentry.requestDataIntegration(),
        // Production keeps it from the default set (`sentry-options.spec.ts`);
        // it is what turns a rethrown 5xx's `cause` into a second exception
        // value (#2131).
        Sentry.linkedErrorsIntegration(),
      ],
      transport: () => ({
        send: (envelope: unknown) => {
          for (const event of eventsFromEnvelope(envelope)) sent.push(event);
          sentTransactions.push(...itemsFromEnvelope(envelope, 'transaction'));
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });
  });

  beforeEach(() => {
    sent = [];
    sentTransactions = [];
  });

  afterAll(async () => {
    await Sentry.close(2000);
    if (originalSalt === undefined) delete process.env.ANALYTICS_HMAC_SALT;
    else process.env.ANALYTICS_HMAC_SALT = originalSalt;
  });

  /**
   * Envelopes are `[headers, items[]]`, each item `[itemHeaders, payload]`.
   * Only `event`-type items carry the error payloads this file asserts on.
   */
  function eventsFromEnvelope(envelope: unknown): ErrorEvent[] {
    // Parsed JSON: the SDK's own serialised events.
    return itemsFromEnvelope(envelope, 'event') as unknown as ErrorEvent[];
  }

  function itemsFromEnvelope(
    envelope: unknown,
    type: string,
  ): Record<string, unknown>[] {
    if (!Array.isArray(envelope) || !Array.isArray(envelope[1])) return [];
    return (envelope[1] as [{ type?: string }, Record<string, unknown>][])
      .filter(([headers]) => headers?.type === type)
      .map(([, payload]) => payload);
  }

  describe('production options', () => {
    // Asserted against the builder's output rather than against what this file
    // passed to `init`, so editing `sentry-options.ts` is what fails these.
    const options = () => buildSentryOptions(FIXTURE_DSN);

    it('wires the scrubber as beforeSend', () => {
      expect(options().beforeSend).toBe(scrubSentryEvent);
    });

    it('leaves no data-collection category to the SDK default (#2722)', () => {
      // Read back from the live client, so this is what the installed SDK
      // resolved, not what the builder wrote. v11 defaults every category to
      // on, so a category missing from `dataCollection` resolves to `true`
      // here. So does one a future SDK adds. Either way `toEqual` fails, and
      // the new category needs a decision before it ships.
      //
      // Literals on purpose: comparing against `sentryDataCollection()` would
      // read the builder back to itself.
      expect(Sentry.getClient()?.getDataCollectionOptions()).toEqual({
        userInfo: false,
        cookies: false,
        httpHeaders: {
          request: { allow: ['content-type', 'x-request-id'] },
          response: false,
        },
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
        frameContextLines: 7,
      });
    });

    it('does not register an OpenTelemetry tracer provider', () => {
      // ADR-22: Sentry owns the API's tracing, with no OpenTelemetry provider
      // under SDK v11. See `sentry-options.spec.ts`.
      expect(options().enableOpenTelemetrySetup).toBe(false);
    });

    it('passes the DSN through', () => {
      expect(options().dsn).toBe(FIXTURE_DSN);
    });

    it('reads environment from NODE_ENV and falls back to development', () => {
      // Asserted against literals with the environment manipulated, not
      // against `process.env.NODE_ENV ?? 'development'` — restating the
      // implementation's own expression is the tautology this file keeps
      // relapsing into, and Jest pins NODE_ENV=test, so the fallback branch is
      // otherwise unreachable and untested.
      const previous = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'staging';
        expect(options().environment).toBe('staging');
        delete process.env.NODE_ENV;
        expect(options().environment).toBe('development');
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    });

    it('reads the trace sample rate from env and defaults to 0.1', () => {
      const previous = process.env.SENTRY_TRACES_SAMPLE_RATE;
      try {
        delete process.env.SENTRY_TRACES_SAMPLE_RATE;
        expect(options().tracesSampleRate).toBe(0.1);
        process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
        expect(options().tracesSampleRate).toBe(0.25);
      } finally {
        if (previous === undefined)
          delete process.env.SENTRY_TRACES_SAMPLE_RATE;
        else process.env.SENTRY_TRACES_SAMPLE_RATE = previous;
      }
    });

    it('falls back to 0.1 for malformed, empty, or out-of-range traces rates', () => {
      const previous = process.env.SENTRY_TRACES_SAMPLE_RATE;
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        process.env.SENTRY_TRACES_SAMPLE_RATE = '0,1';
        expect(Number.isFinite(options().tracesSampleRate)).toBe(true);
        expect(options().tracesSampleRate).toBe(0.1);
        expect(warn).toHaveBeenCalled();

        warn.mockClear();
        process.env.SENTRY_TRACES_SAMPLE_RATE = '';
        expect(options().tracesSampleRate).toBe(0.1);
        expect(warn).toHaveBeenCalled();

        warn.mockClear();
        process.env.SENTRY_TRACES_SAMPLE_RATE = '2';
        expect(options().tracesSampleRate).toBe(0.1);

        warn.mockClear();
        delete process.env.SENTRY_TRACES_SAMPLE_RATE;
        expect(options().tracesSampleRate).toBe(0.1);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
        if (previous === undefined)
          delete process.env.SENTRY_TRACES_SAMPLE_RATE;
        else process.env.SENTRY_TRACES_SAMPLE_RATE = previous;
      }
      // #2040: a malformed value used to yield NaN, which the SDK reads as
      // tracing-enabled. Every built options object must carry a finite rate.
    });

    it('does not let transaction events through unscrubbed', () => {
      // Guards the plausible wrong fix for #896. `scrubSentryEvent` cannot be
      // reused for transactions (it would drop `spans`), which invites a
      // `beforeSendTransaction: (e) => e` passthrough instead — spans carry
      // `http.url` and `url.query`, exactly the query-string leak the
      // free-text sweep exists to close. Written forward-compatibly: unset is
      // the status quo, and any future hook must actually redact.
      const hook = options().beforeSendTransaction;
      if (hook === undefined) return;
      const email = ['ops', 'example.com'].join('@');
      const out = hook(
        {
          type: 'transaction',
          transaction: `/v1/chapters?notify=${email}`,
          spans: [],
        } as unknown as Parameters<typeof hook>[0],
        {},
      );
      expect(JSON.stringify(out)).not.toContain(email);
    });

    it('wires a transaction hook that keeps the span tree', () => {
      // The companion to the guard above, and the reason it is not enough on
      // its own. `beforeSendTransaction: scrubSentryEvent` — the exact wrong
      // fix #896 warns about — *passes* that test: it redacts the transaction
      // name just fine, then silently drops `spans`, which is absent from its
      // allowlist. The transaction still ships, so nothing looks broken while
      // every trace arrives empty. Only asserting survival catches it.
      const hook = options().beforeSendTransaction;
      expect(hook).toBeDefined();

      const out = hook!(
        {
          type: 'transaction',
          transaction: '/v1/chapters',
          spans: [
            {
              span_id: 'span0001',
              trace_id: 'trace001',
              start_timestamp: 1,
              op: 'http.client',
              data: {},
            },
          ],
        } as unknown as Parameters<NonNullable<typeof hook>>[0],
        {},
      );

      expect((out as { spans?: unknown[] } | null)?.spans).toHaveLength(1);
    });
  });

  it('ships captureException through beforeSend with scope tags applied', async () => {
    Sentry.withScope((scope) => {
      scope.setTag('request_id', 'req-integration-1');
      scope.setTag('status_code', '500');
      Sentry.captureException(new Error('integration failure'));
    });
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    const [event] = sent;
    expect(event.exception?.values?.[0]?.value).toBe('integration failure');
    expect(event.tags).toMatchObject({
      request_id: 'req-integration-1',
      status_code: '500',
    });
  });

  it('ships captureMessage with its text, level and user intact', async () => {
    const pseudonym = 'a'.repeat(64);
    const text = 'Auth failure spike: 12 failures from one origin';
    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setTag('security_event', 'auth_failure_spike');
      scope.setUser({ id: pseudonym });
      Sentry.captureMessage(text);
    });
    await Sentry.flush(2000);

    // Length matters as much as content: a scrubber that returns `null` for
    // message events would silence every security alert, and asserting only on
    // `sent[0]` would not notice.
    expect(sent).toHaveLength(1);
    const [event] = sent;
    // The SDK may carry message text as `message` or `logentry`, and only
    // `message` is allowlisted — a future shape change would blank every alert.
    expect(event.message).toBe(text);
    expect(event.level).toBe('warning');
    expect(event.tags).toMatchObject({ security_event: 'auth_failure_spike' });
    expect(event.user?.id).toBe(pseudonym);
  });

  it('ships no cookie, secret header, query string or body from the request', async () => {
    // The request as `RequestData` finds it on the isolation scope, which is
    // where the HTTP server integration leaves it in production. Every value
    // is runtime-assembled so a `ContextLines` echo of this file cannot put
    // one on the wire (see the note above the Stripe test).
    const marker = (name: string) => ['leak', name, 'marker'].join('_');
    Sentry.withIsolationScope((isolationScope) => {
      isolationScope.setSDKProcessingMetadata({
        normalizedRequest: {
          method: 'POST',
          url: `https://api.example.invalid/v1/members?invite=${marker('query')}`,
          query_string: `invite=${marker('query')}`,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req-integration-2',
            authorization: `Bearer ${marker('auth')}`,
            cookie: `sb-access-token=${marker('cookie')}`,
            'x-note': marker('header'),
          },
          cookies: { 'sb-access-token': marker('cookie') },
          data: JSON.stringify({ email: marker('body') }),
        },
      });
      Sentry.captureException(new Error('request data check'));
    });
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    const json = JSON.stringify(sent[0]);
    for (const name of ['query', 'auth', 'cookie', 'header', 'body']) {
      expect(json).not.toContain(marker(name));
    }
    // What the scrubber keeps must still arrive, or this would pass on an
    // event with no request at all.
    expect(sent[0].request).toMatchObject({
      method: 'POST',
      url: '/v1/members',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-integration-2',
      },
    });
  });

  it('ships a transaction through beforeSendTransaction (#2722)', async () => {
    // SDK v11's default trace lifecycle streams spans and never calls
    // `beforeSendTransaction`, so the transaction scrubber would be skipped
    // while this file's other tests, all error events, stayed green. This is
    // the one that reads a real transaction off the transport.
    const email = ['ops', 'example.com'].join('@');
    Sentry.startSpan(
      {
        name: `GET /v1/chapters?notify=${email}`,
        op: 'http.server',
        forceTransaction: true,
        attributes: { 'url.query': `notify=${email}` },
      },
      () => undefined,
    );
    await Sentry.flush(2000);

    expect(sentTransactions).toHaveLength(1);
    const json = JSON.stringify(sentTransactions[0]);
    expect(json).not.toContain(email);
    expect(json).not.toContain('url.query');
    expect(sentTransactions[0].transaction).toBe('GET /v1/chapters');
  });

  it('scrubs PII out of tag values', async () => {
    // Nothing else in the repo covers `scrubTags`: replacing its body with
    // `return tags;` left all 87 suites green before this test existed. Tags
    // are not incidental — `all-exceptions.filter.ts` sets `origin` (an IP
    // hash), `chapter`, and `route` on every reported error, so tag values are
    // a live path to the wire.
    const email = ['ops', 'example.com'].join('@');
    Sentry.withScope((scope) => {
      scope.setTag('note', `escalate to ${email}`);
      Sentry.captureException(new Error('tag scrub check'));
    });
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    const tags = JSON.stringify(sent[0].tags);
    expect(tags).not.toContain(email);
    expect(tags).toContain('[redacted:email]');
  });

  it('scrubs PII out of a real captured exception message', async () => {
    // Assembled at runtime: the capture site below sits inside the ~7-line
    // window `ContextLines` copies off disk, so a literal here would be echoed
    // back into the payload and could satisfy the assertion by itself.
    const email = ['member', 'example.com'].join('@');
    Sentry.captureException(
      new Error(`upsert failed for ${email} (${USER_UUID})`),
    );
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    const json = JSON.stringify(sent[0]);
    expect(json).not.toContain(email);
    expect(json).not.toContain(USER_UUID);
    // Exception value specifically, so `[redacted:email]` is not satisfied by
    // an echo of this assertion in source context.
    const value = sent[0].exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain(email);
    expect(value).not.toContain(USER_UUID);
    expect(value).toContain('[redacted:email]');
    expect(value).toMatch(/\[id:[0-9a-f]{64}\]/);
  });

  describe('a rethrown 5xx and its cause (#2131)', () => {
    // Runtime-assembled: `ContextLines` copies the source around each frame
    // into the payload, so a literal would be echoed back by this file itself.
    const RAW_FIELD_MARKER = ['req', 'raw', 'field', 'marker'].join('_');
    const email = ['treasurer', 'example.com'].join('@');

    it('ships the cause as a second exception value, scrubbed like the first', async () => {
      // A real SDK error: its fields (`requestId`, `raw`, `headers`) are what
      // must not ride along, and its `name` is 'Error' (the class is on `type`).
      const cause = new Stripe.errors.StripeInvalidRequestError({
        message: `No such customer for ${email}`,
        code: 'resource_missing',
        requestId: RAW_FIELD_MARKER,
      });
      Sentry.captureException(
        new ServiceUnavailableException(
          'Billing service is temporarily unavailable',
          { cause },
        ),
      );
      await Sentry.flush(2000);

      expect(sent).toHaveLength(1);
      const values = sent[0].exception?.values ?? [];
      // Sentry orders the chain innermost first; the rethrow is last. The
      // cause's type is the generic 'Error', which is why the exception filter
      // also sets a fingerprint (`all-exceptions.filter.sentry.spec.ts`).
      expect(values.map((value) => value.type)).toEqual([
        'Error',
        'ServiceUnavailableException',
      ]);
      const [shippedCause, outer] = values;
      expect(outer.value).toBe('Billing service is temporarily unavailable');
      expect(shippedCause.value).toContain('No such customer for');
      expect(shippedCause.value).not.toContain(email);
      expect(shippedCause.value).toContain('[redacted:email]');
      // Only allowlisted keys survive on each value; the provider's own fields
      // never ride along.
      for (const value of values) {
        expect(
          Object.keys(value).every((key) =>
            [
              'type',
              'value',
              'module',
              'thread_id',
              'mechanism',
              'stacktrace',
            ].includes(key),
          ),
        ).toBe(true);
      }
      expect(JSON.stringify(sent[0])).not.toContain(RAW_FIELD_MARKER);
    });
  });
});
