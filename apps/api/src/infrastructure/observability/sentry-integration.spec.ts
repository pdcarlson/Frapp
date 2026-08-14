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
 * **Scope of "production options", stated precisely.** `dsn`, `environment`,
 * `tracesSampleRate`, `sendDefaultPii` and `beforeSend` come from the builder
 * and are what the assertions below exercise. `transport`, `integrations` and
 * `defaultIntegrations` are overridden here, so this file would *not* notice
 * production adding any of those three — the default integration set leaks a
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
 * assertion here would pass with `scrubException`'s `delete kept.vars`
 * removed, making it worse than no test. That rule is covered where it can
 * actually fail — `sentry-scrubbing.spec.ts:151` builds a frame carrying
 * `vars` by hand and asserts it does not survive. **Do not read that as the
 * rule being dead:** `LocalVariablesAsync` ships in production's default
 * integration set and `sendDefaultPii: false` still resolves
 * `stackFrameVariables: true`, so enabling `includeLocalVariables` for
 * debugging would immediately put request payloads behind that rule.
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
      // Asserting the concrete default matters beyond correctness: transaction
      // events bypass the scrubber entirely (#896), so a silent rate increase
      // widens a known-unscrubbed path. A malformed value yields NaN, which
      // the SDK reads as tracing-enabled — #904.
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
    // Asserted on the exception value, not the serialized event, for the same
    // source-echo reason.
    const value = sent[0].exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain(email);
    expect(value).not.toContain(USER_UUID);
    expect(value).toContain('[redacted:email]');
    expect(value).toMatch(/\[id:[0-9a-f]{64}\]/);
  });
});
