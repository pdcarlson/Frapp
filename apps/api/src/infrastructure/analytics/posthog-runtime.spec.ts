import { SENTRY_ERROR_CORRELATED_EVENT } from '@repo/observability';
import { hashUserIdForAnalytics } from '@repo/validation';
import {
  enqueueSanitizedLog,
  PosthogRuntime,
  resetPosthogRuntimeForTests,
  shouldSample,
  startPosthogRuntime,
} from './posthog-runtime';
import { RecordingPosthogTransport } from './posthog-transport';
import { runWithRequestLogStore } from '../observability/request-als';

const HEX = 'a'.repeat(64);
const USER_UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const EMAIL = 'member@example.com';
const IP = '203.0.113.42';
const STACK = 'Error: boom\n    at Object.<anonymous>';

const FIXTURES = [USER_UUID, EMAIL, IP, STACK, 'secret-invite'];

function startRuntime(
  transport: RecordingPosthogTransport,
  extras: { flushAt?: number; logsSampleRate?: number } = {},
): PosthogRuntime {
  return startPosthogRuntime({
    config: { apiKey: 'phc_testkey', host: 'https://ph.example.test' },
    fetch: transport.fetch,
    flushAt: extras.flushAt ?? 20,
    flushInterval: 0,
    fetchRetryCount: 2,
    fetchRetryDelay: 0,
    disableCompression: true,
    logsSampleRate: extras.logsSampleRate ?? 1,
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
    // `fetch` is readonly on the transport; this test swaps it for a hung one.
    const patchable: { fetch: typeof original } = transport;
    patchable.fetch = async (url, options) => {
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

    runtime.enqueueSanitizedLog({
      body: 'request',
      severity: 'INFO',
      attributes: {
        request_id: 'req-1',
        path: '/v1/health',
        status_class: '2xx',
        user_hash: HEX,
      },
    });
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

  describe('log sampling (#2374)', () => {
    it('keeps everything at rate 1 and nothing at rate 0', () => {
      expect(shouldSample('same-key', 0)).toBe(false);
      expect(shouldSample('same-key', 1)).toBe(true);
    });

    it('decides from the key: two pinned keys straddle rate 0.5', () => {
      // sha256 places `key-c` at 0.285 and `key-b` at 0.637 of the range, so
      // a sampler that ignores its key cannot answer both correctly.
      expect(shouldSample('key-c', 0.5)).toBe(true);
      expect(shouldSample('key-b', 0.5)).toBe(false);
      expect(shouldSample('key-b', 0.7)).toBe(true);
    });

    it('keeps about half of 1000 distinct keys at rate 0.5', () => {
      let kept = 0;
      for (let i = 0; i < 1000; i++) {
        if (shouldSample(`key-${i}`, 0.5)) kept++;
      }
      expect(kept).toBe(511);
      expect(kept).toBeGreaterThan(450);
      expect(kept).toBeLessThan(550);
    });

    /** Records exported out of 200, each enqueued inside `requestId`'s ALS run when one is given. */
    async function exportedCount(
      rate: number,
      requestId?: string,
    ): Promise<number> {
      const transport = new RecordingPosthogTransport(FIXTURES);
      const runtime = startRuntime(transport, { logsSampleRate: rate });
      // The exported wrapper, the one every production caller goes through.
      const enqueue = () =>
        enqueueSanitizedLog({
          body: 'sample_probe',
          severity: 'INFO',
          attributes: {},
        });
      for (let i = 0; i < 200; i++) {
        if (requestId === undefined) enqueue();
        else runWithRequestLogStore({ requestId }, enqueue);
      }
      await runtime.flush();
      return transport.calls
        .filter((call) => call.url.includes('/i/v1/logs'))
        .reduce(
          (n, call) =>
            n + (call.decodedBody?.split('sample_probe').length ?? 1) - 1,
          0,
        );
    }

    it("gives every record of one request that request's verdict", async () => {
      // sha256 places `req-a` at 0.429 and `req-dropped` at 0.675.
      expect(await exportedCount(0.5, 'req-a')).toBe(200);
      expect(await exportedCount(0.5, 'req-dropped')).toBe(0);
    });

    it.each([
      ['outside any request', undefined],
      ['under an empty inbound x-request-id', ''],
    ])('samples each record %s on its own', async (_label, requestId) => {
      // 200 fair coin flips: the band is more than five standard deviations
      // wide on each side, and all-or-nothing is what a shared key gives.
      const kept = await exportedCount(0.5, requestId);
      expect(kept).toBeGreaterThan(60);
      expect(kept).toBeLessThan(140);
    });
  });
});
