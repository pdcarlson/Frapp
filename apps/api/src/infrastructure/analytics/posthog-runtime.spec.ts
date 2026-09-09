import { SENTRY_ERROR_CORRELATED_EVENT } from '@repo/observability';
import { hashUserIdForAnalytics } from '@repo/validation';
import {
  PosthogRuntime,
  resetPosthogRuntimeForTests,
  shouldSample,
  startPosthogRuntime,
} from './posthog-runtime';
import { RecordingPosthogTransport } from './posthog-transport';

const HEX = 'a'.repeat(64);
const USER_UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const EMAIL = 'member@example.com';
const IP = '203.0.113.42';
const STACK = 'Error: boom\n    at Object.<anonymous>';

const FIXTURES = [USER_UUID, EMAIL, IP, STACK, 'secret-invite'];

function startRuntime(
  transport: RecordingPosthogTransport,
  extras: { flushAt?: number } = {},
): PosthogRuntime {
  return startPosthogRuntime({
    config: { apiKey: 'phc_testkey', host: 'https://ph.example.test' },
    fetch: transport.fetch,
    flushAt: extras.flushAt ?? 20,
    flushInterval: 0,
    fetchRetryCount: 2,
    fetchRetryDelay: 0,
    disableCompression: true,
    logsSampleRate: 1,
  });
}

describe('PosthogRuntime', () => {
  afterEach(async () => {
    await resetPosthogRuntimeForTests();
  });

  it('returns from capture before the transport resolves', async () => {
    let release: ((value: unknown) => void) | undefined;
    const hung = new Promise((resolve) => {
      release = resolve;
    });
    const transport = new RecordingPosthogTransport(FIXTURES);
    const original = transport.fetch;
    let fetchStarted = 0;
    transport.fetch = async (url, options) => {
      fetchStarted += 1;
      const recorded = await original(url, options);
      await hung;
      return recorded;
    };
    const runtime = startRuntime(transport, { flushAt: 1 });

    const started = Date.now();
    await runtime.analytics.capture({
      name: 'opened-channel',
      distinctId: HEX,
      properties: { channel_kind: 'general' },
    });
    expect(Date.now() - started).toBeLessThan(100);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(fetchStarted).toBe(1);
    expect(transport.calls.some((call) => call.url.includes('/batch'))).toBe(
      true,
    );

    release?.({ status: 1 });
    await runtime.flush();
  });

  it('retries then drops an HTTP 5xx batch; forget reports false', async () => {
    const transport = new RecordingPosthogTransport(FIXTURES);
    transport.setMode({ type: 'http', status: 503 });
    const runtime = startRuntime(transport);

    await expect(runtime.forget(HEX)).resolves.toBe(false);
    expect(transport.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('retries a transient HTTP error and then forgets successfully', async () => {
    const transport = new RecordingPosthogTransport(FIXTURES);
    transport.setMode({ type: 'http', status: 503, times: 1 });
    const runtime = startRuntime(transport);

    await expect(runtime.forget(HEX)).resolves.toBe(true);
  });

  it('reports forget false after a persistent network error', async () => {
    const transport = new RecordingPosthogTransport(FIXTURES);
    transport.setMode({ type: 'network' });
    const runtime = startRuntime(transport);

    await expect(runtime.forget(HEX)).resolves.toBe(false);
  });

  it('does not put PII or exception payloads on a product event envelope', async () => {
    const transport = new RecordingPosthogTransport(FIXTURES);
    const runtime = startRuntime(transport);

    runtime.captureEvent({
      name: 'opened-channel',
      distinctId: hashUserIdForAnalytics('salt', 'user-not-uuid'),
      properties: { channel_kind: 'general' },
    });
    await runtime.flush();

    const batch = transport.calls.find((call) => call.url.includes('/batch'));
    expect(batch).toBeDefined();
    expect(batch?.decodedBody).not.toContain(USER_UUID);
    expect(batch?.decodedBody).not.toContain(EMAIL);
    expect(batch?.decodedBody).not.toContain('$exception');
  });

  it('allowlists sentry-error-correlated properties and drops the rest', async () => {
    const transport = new RecordingPosthogTransport(FIXTURES);
    const runtime = startRuntime(transport);

    runtime.captureSentryErrorCorrelated(HEX, {
      sentry_event_id: 'evt_1',
      trace_id: 'a'.repeat(32),
      request_id: 'req-abc',
      route: '/v1/chapters',
      status_class: '5xx',
      release: 'deadbeef',
      exception: 'Error: boom',
      stack: STACK,
      message: 'database exploded',
      body: '{"password":"x"}',
      query: 'invite=secret-invite',
    });
    await runtime.flush();

    const batch = transport.calls.find((call) => call.url.includes('/batch'));
    expect(batch?.decodedBody).toContain(SENTRY_ERROR_CORRELATED_EVENT);
    expect(batch?.decodedBody).toContain('evt_1');
    expect(batch?.decodedBody).not.toContain('database exploded');
    expect(batch?.decodedBody).not.toContain(STACK);
    expect(batch?.decodedBody).not.toContain('secret-invite');
    expect(batch?.decodedBody).not.toContain('password');
  });

  it('exports sanitized logs independently of /batch/ and without raw ids', async () => {
    const transport = new RecordingPosthogTransport(FIXTURES);
    const runtime = startRuntime(transport);

    runtime.enqueueSanitizedLog(
      {
        body: 'request',
        severity: 'INFO',
        attributes: {
          request_id: 'req-1',
          path: '/v1/health',
          status_class: '2xx',
          user_hash: HEX,
        },
      },
      'req-1',
    );
    await runtime.flush();

    const logs = transport.calls.find((call) =>
      call.url.includes('/i/v1/logs'),
    );
    expect(logs).toBeDefined();
    expect(logs?.decodedBody).toContain('request');
    expect(logs?.decodedBody).toContain(HEX);
    expect(logs?.decodedBody).not.toContain(USER_UUID);
  });

  it('evaluates flags only with hex distinct/chapter ids and fails closed otherwise', async () => {
    const transport = new RecordingPosthogTransport(FIXTURES);
    transport.flagValues = { 'new-composer': true };
    const runtime = startRuntime(transport);

    await expect(
      runtime.isFeatureEnabled('new-composer', USER_UUID),
    ).resolves.toBe(false);
    await expect(
      runtime.isFeatureEnabled('new-composer', HEX, USER_UUID),
    ).resolves.toBe(false);
    await expect(
      runtime.isFeatureEnabled('new-composer', HEX, HEX),
    ).resolves.toBe(true);
  });

  it('samples logs deterministically from the key, not Math.random', () => {
    expect(shouldSample('same-key', 0)).toBe(false);
    expect(shouldSample('same-key', 1)).toBe(true);
    expect(shouldSample('same-key', 0.5)).toBe(shouldSample('same-key', 0.5));
  });
});
