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
 * Three construction choices, each fixing a way an earlier draft of this file
 * managed to pass while proving nothing:
 *
 *  - **Options come from {@link buildSentryOptions}**, the same function
 *    `main.ts` calls. A draft that re-declared them locally made
 *    `expect(sendDefaultPii).toBe(false)` a tautology reading back its own
 *    literal, and would have stayed green while production flipped to `true`.
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
 * Integrations are pinned to the two that shape what the scrubber must handle
 * here — source context and request data — rather than left at the default
 * set, which leaks a test environment per worker (`jest --detectLeaks` fails).
 *
 * `localVariablesIntegration` is deliberately absent: it only populates
 * `frame.vars` for *uncaught* exceptions, so under `captureException` it
 * attaches nothing, and a test asserting `vars` is stripped would pass even
 * with `scrubException`'s `delete kept.vars` removed. That rule is covered
 * where it can actually fail — `sentry-scrubbing.spec.ts:151` builds a frame
 * carrying `vars` by hand and asserts it does not survive.
 */

/** Well-formed but deliberately unroutable — `.invalid` is reserved (RFC 2606). */
const FIXTURE_DSN = 'https://fixturekey@o0.ingest.example.invalid/1';
const SALT = 'test-salt-for-integration';
const USER_UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('Sentry SDK integration', () => {
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;
  /** Event payloads as the transport received them — i.e. what would ship. */
  let sent: ErrorEvent[] = [];

  beforeAll(() => {
    process.env.ANALYTICS_HMAC_SALT = SALT;

    Sentry.init({
      // Spread verbatim: `beforeSend` is production's, unwrapped, so a `null`
      // return still drops the event exactly as it does in the API.
      ...buildSentryOptions(FIXTURE_DSN),
      defaultIntegrations: false,
      integrations: [
        Sentry.contextLinesIntegration(),
        Sentry.requestDataIntegration(),
      ],
      transport: () => ({
        send: (envelope: unknown) => {
          for (const event of eventsFromEnvelope(envelope)) sent.push(event);
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });
  });

  beforeEach(() => {
    sent = [];
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
    if (!Array.isArray(envelope) || !Array.isArray(envelope[1])) return [];
    return (envelope[1] as [{ type?: string }, ErrorEvent][])
      .filter(([headers]) => headers?.type === 'event')
      .map(([, payload]) => payload);
  }

  describe('production options', () => {
    // Asserted against the builder's output rather than against what this file
    // passed to `init`, so editing `sentry-options.ts` is what fails these.
    const options = () => buildSentryOptions(FIXTURE_DSN);

    it('wires the scrubber as beforeSend', () => {
      expect(options().beforeSend).toBe(scrubSentryEvent);
    });

    it('disables the SDK-level PII collection switch', () => {
      // Under v10 this flag is a key-name filter, not a collection switch, so
      // it is a floor rather than the whole PII story — `beforeSend` is. #896.
      expect(options().sendDefaultPii).toBe(false);
    });

    it('passes the DSN through and defaults environment and sample rate', () => {
      const built = options();
      expect(built.dsn).toBe(FIXTURE_DSN);
      expect(built.environment).toBe(process.env.NODE_ENV ?? 'development');
      // A malformed SENTRY_TRACES_SAMPLE_RATE yields NaN, and the SDK treats a
      // non-null rate as "tracing on" — so assert a usable number, not just
      // that the key exists. See #904.
      expect(Number.isFinite(built.tracesSampleRate)).toBe(true);
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
    // Asserted on the exception value, not the serialized event, for the same
    // source-echo reason.
    const value = sent[0].exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain(email);
    expect(value).not.toContain(USER_UUID);
    expect(value).toContain('[redacted:email]');
    expect(value).toMatch(/\[id:[0-9a-f]{64}\]/);
  });
});
