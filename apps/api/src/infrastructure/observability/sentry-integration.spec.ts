import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';
import { scrubSentryEvent } from './sentry-scrubbing';

/**
 * End-to-end wiring test for the **real** Sentry SDK (issue #682).
 *
 * Every other Sentry spec in this repo stubs the SDK: `sentry-scrubbing.spec.ts`
 * calls `scrubSentryEvent` as a plain function, and
 * `all-exceptions.filter.spec.ts` opens with `jest.mock('@sentry/nestjs')`. Both
 * are the right shape for what they test, but between them nothing ever asks the
 * installed SDK whether `main.ts`'s `Sentry.init` options are still honoured —
 * so a major-version bump could silently stop invoking `beforeSend` and every
 * existing test would stay green while the API quietly shipped unscrubbed PII.
 *
 * That gap is exactly what the v9 → v10 bump put at risk, so this closes it: it
 * initializes the SDK the way `main.ts` does, captures through the same two
 * entry points `all-exceptions.filter.ts` uses, and asserts the scrubber ran on
 * what came out.
 *
 * The transport is stubbed rather than the network being blocked, so the test is
 * hermetic by construction — there is no DSN that could resolve and no envelope
 * that could leave the process, on any machine or CI runner.
 */

/** Well-formed but deliberately unroutable — `.invalid` is reserved (RFC 2606). */
const FIXTURE_DSN = 'https://fixturekey@o0.ingest.example.invalid/1';
const SALT = 'test-salt-for-integration';
/** Split so the assembled uuid never appears as a literal — see the PII test. */
const USER_UUID_PARTS = ['3f2a1b4c', '5d6e', '4f70', '8a9b', '0c1d2e3f4a5b'];

describe('Sentry SDK integration', () => {
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;
  /** Events as `beforeSend` saw them — i.e. post-scrub, pre-transport. */
  let captured: ErrorEvent[] = [];

  beforeAll(() => {
    process.env.ANALYTICS_HMAC_SALT = SALT;

    Sentry.init({
      dsn: FIXTURE_DSN,
      environment: 'test',
      tracesSampleRate: 0,
      sendDefaultPii: false,
      // The same composition as `main.ts`: the production scrubber is the
      // `beforeSend`, so this asserts the real pipeline rather than a stand-in.
      beforeSend: (event) => {
        const scrubbed = scrubSentryEvent(event);
        if (scrubbed) captured.push(scrubbed);
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

  it('initializes a client from the options main.ts passes', () => {
    const client = Sentry.getClient();
    expect(client).toBeDefined();
    expect(client?.getOptions().environment).toBe('test');
    // The switch the whole PII posture hangs on — if a future major flips this
    // default, the SDK starts collecting IPs and bodies before `beforeSend`.
    expect(client?.getOptions().sendDefaultPii).toBe(false);
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

  it('routes captureMessage through beforeSend and preserves level and user', async () => {
    const pseudonym = 'a'.repeat(64);
    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setTag('security_event', 'auth_failure_spike');
      scope.setUser({ id: pseudonym });
      Sentry.captureMessage('Auth failure spike: 12 failures from one origin');
    });
    await Sentry.flush(2000);

    expect(captured).toHaveLength(1);
    const [event] = captured;
    expect(event.level).toBe('warning');
    expect(event.tags).toMatchObject({ security_event: 'auth_failure_spike' });
    // Already-pseudonymous, so the scrubber's `user` rule keeps it. This is the
    // half of the contract `all-exceptions.filter.ts` relies on when it hashes
    // ids at the source rather than leaving them for `beforeSend`.
    expect(event.user?.id).toBe(pseudonym);
  });

  it('scrubs PII out of a real captured exception message', async () => {
    // Assembled at runtime, never written as a literal. The SDK's ContextLines
    // integration attaches the *source lines* surrounding each stack frame, so
    // any PII-shaped string spelled out in this file would be echoed back into
    // the event from disk and defeat the whole-payload assertion below — while
    // saying nothing about whether the scrubber works. Building the values here
    // keeps that assertion meaningful: the only way they can reach the event is
    // through the runtime path the scrubber is responsible for.
    const email = ['member', 'example.com'].join('@');
    const uuid = USER_UUID_PARTS.join('-');

    Sentry.captureException(new Error(`upsert failed for ${email} (${uuid})`));
    await Sentry.flush(2000);

    expect(captured).toHaveLength(1);
    const serialized = JSON.stringify(captured[0]);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(uuid);
    expect(serialized).toContain('[redacted:email]');
  });
});
