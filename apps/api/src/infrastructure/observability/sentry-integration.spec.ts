import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';
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
 * The options come from {@link buildSentryOptions}, the same function `main.ts`
 * calls. That is deliberate and load-bearing: an earlier draft of this file
 * re-declared the options locally, which made `expect(sendDefaultPii).toBe(false)`
 * a tautology — it only read back the literal the test itself had passed, and
 * would have stayed green while production flipped to `true`.
 *
 * Two things are overridden, both for hermeticity rather than convenience:
 *
 *  - **`transport`** — a stub, so no envelope can leave the process and the
 *    `.invalid` DSN is never resolved, on any machine or CI runner.
 *  - **tracing** — `tracesSampleRate` is *removed* rather than set to `0`,
 *    because `hasSpansEnabled` is a nullish check and `0` still counts as
 *    enabled. Leaving it on loads ~28 OpenTelemetry auto-instrumentations
 *    (Postgres, Redis, Kafka, Prisma…) inside a unit test; they subscribe to a
 *    worker-global `diagnostics_channel` that `Sentry.close()` does not
 *    unsubscribe, which shows up as a `--detectLeaks` failure. `beforeSend` is
 *    client-level, so dropping them costs this file nothing.
 */

/** Well-formed but deliberately unroutable — `.invalid` is reserved (RFC 2606). */
const FIXTURE_DSN = 'https://fixturekey@o0.ingest.example.invalid/1';
const SALT = 'test-salt-for-integration';
const USER_UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('Sentry SDK integration', () => {
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;
  /** Events as `beforeSend` saw them — i.e. post-scrub, pre-transport. */
  let captured: ErrorEvent[] = [];

  beforeAll(() => {
    process.env.ANALYTICS_HMAC_SALT = SALT;

    const { tracesSampleRate: _drop, ...production } =
      buildSentryOptions(FIXTURE_DSN);

    Sentry.init({
      ...production,
      // See the file docblock: the default set registers subscribers on a
      // worker-global `diagnostics_channel` that `Sentry.close()` never
      // unsubscribes, which Jest reports as a leaked test environment.
      // `beforeSend` is client-level, so none of this file's assertions
      // depend on an integration being present.
      defaultIntegrations: false,
      beforeSend: (event, hint) => {
        // Delegate to whatever production configured, then record the result,
        // so this observes the real scrubber rather than substituting for it.
        const scrubbed = production.beforeSend?.(event, hint) ?? event;
        if (scrubbed && !(scrubbed instanceof Promise)) {
          captured.push(scrubbed as ErrorEvent);
        }
        return scrubbed;
      },
      transport: () => ({
        send: () => Promise.resolve({ statusCode: 200 }),
        flush: () => Promise.resolve(true),
      }),
    });
  });

  beforeEach(() => {
    captured = [];
  });

  afterAll(async () => {
    await Sentry.close(2000);
    if (originalSalt === undefined) delete process.env.ANALYTICS_HMAC_SALT;
    else process.env.ANALYTICS_HMAC_SALT = originalSalt;
  });

  describe('production options', () => {
    it('wires the scrubber as beforeSend', () => {
      // Asserted on the builder's output, not on what this file passed to
      // init — deleting `beforeSend` from `sentry-options.ts` fails here.
      expect(buildSentryOptions(FIXTURE_DSN).beforeSend).toBe(scrubSentryEvent);
    });

    it('disables the SDK-level PII collection switch', () => {
      // Same reasoning: this reads production config. Under v10 the flag is a
      // key-based filter rather than a collection switch, so it is a floor and
      // not the whole PII story — `beforeSend` is. See #896.
      expect(buildSentryOptions(FIXTURE_DSN).sendDefaultPii).toBe(false);
    });

    it('builds a client the SDK accepts', () => {
      expect(Sentry.getClient()).toBeDefined();
    });
  });

  it('routes captureException through beforeSend and applies scope tags', async () => {
    Sentry.withScope((scope) => {
      scope.setTag('request_id', 'req-integration-1');
      scope.setTag('status_code', '500');
      Sentry.captureException(new Error('integration failure'));
    });
    await Sentry.flush(2000);

    expect(captured).toHaveLength(1);
    const [event] = captured;
    expect(event.exception?.values?.[0]?.value).toBe('integration failure');
    expect(event.tags).toMatchObject({
      request_id: 'req-integration-1',
      status_code: '500',
    });
  });

  it('routes captureMessage through beforeSend, preserving text, level and user', async () => {
    const pseudonym = 'a'.repeat(64);
    const text = 'Auth failure spike: 12 failures from one origin';
    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setTag('security_event', 'auth_failure_spike');
      scope.setUser({ id: pseudonym });
      Sentry.captureMessage(text);
    });
    await Sentry.flush(2000);

    expect(captured).toHaveLength(1);
    const [event] = captured;
    // The SDK may carry message text as `message` or as `logentry`, and only
    // `message` is on the scrubber's allowlist — so if a future version switches
    // shape, the spike alerts in `all-exceptions.filter.ts` would arrive blank.
    // Asserting the text (not just the tags) is what would catch that.
    expect(event.message).toBe(text);
    expect(event.level).toBe('warning');
    expect(event.tags).toMatchObject({ security_event: 'auth_failure_spike' });
    // Already-pseudonymous, so the scrubber's `user` rule keeps it.
    expect(event.user?.id).toBe(pseudonym);
  });

  it('scrubs PII out of a real captured exception message', async () => {
    const email = ['member', 'example.com'].join('@');
    Sentry.captureException(
      new Error(`upsert failed for ${email} (${USER_UUID})`),
    );
    await Sentry.flush(2000);

    expect(captured).toHaveLength(1);
    // Asserted against the exception value specifically, NOT the serialized
    // event. The SDK's ContextLines integration attaches ~7 source lines around
    // each stack frame, so this file's own text lands in the payload: an earlier
    // draft asserted `JSON.stringify(event)` contained '[redacted:email]' and
    // passed purely off that echo — it stayed green with the scrubber replaced
    // by the identity function. The email is still assembled at runtime because
    // the capture site above sits inside the context window.
    const value = captured[0].exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain(email);
    expect(value).not.toContain(USER_UUID);
    expect(value).toContain('[redacted:email]');
    expect(value).toMatch(/\[id:[0-9a-f]{64}\]/);
  });
});
