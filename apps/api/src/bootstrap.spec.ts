import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { configureApp, TRUST_PROXY_HOPS } from './bootstrap';
import { enqueueSanitizedLog } from './infrastructure/analytics/posthog-runtime';
import { getRequestId } from './infrastructure/observability/request-als';
import type { DeploymentEnvironment } from './interface/http/deployment-environment';
import { createProxyChainTripwire } from './interface/middleware/proxy-chain-tripwire.middleware';

jest.mock('./infrastructure/analytics/posthog-runtime', () => ({
  enqueueSanitizedLog: jest.fn(),
  captureSentryErrorCorrelated: jest.fn(),
}));

// What the tripwire reports is its own spec's business; here the question is
// only which deployments register it, and with which count.
jest.mock('./interface/middleware/proxy-chain-tripwire.middleware', () => ({
  createProxyChainTripwire: jest.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

/** Echoes what Express resolved, so the assertions read the real resolution. */
@Controller('echo')
class EchoController {
  @Get()
  echo(@Req() req: Request): { ip?: string; ips: string[] } {
    return { ip: req.ip, ips: req.ips };
  }
}

/** No `environment` configures for this process, which under Jest is `local`. */
async function createConfiguredEchoApp(
  environment?: DeploymentEnvironment,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [EchoController],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, environment);
  await app.init();
  return app;
}

function headerList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

describe('configureApp', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createConfiguredEchoApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('trust proxy (#864)', () => {
    const get = (xff?: string) => {
      const req = request(app.getHttpServer()).get('/v1/echo');
      return xff === undefined ? req : req.set('X-Forwarded-For', xff);
    };

    it('sets the measured hop count on the Express instance', () => {
      const instance = app
        .getHttpAdapter()
        .getInstance<{ get: (setting: string) => unknown }>();

      expect(instance.get('trust proxy')).toBe(TRUST_PROXY_HOPS.local);
      // Measured per service: staging's chain is three entries (#864),
      // production's two (#2972). `local` carries staging's figure.
      expect(TRUST_PROXY_HOPS).toEqual({ production: 2, staging: 3, local: 3 });
    });

    // The whole point of a hop *count*: entries beyond the trusted ones are the
    // client's to forge, and must not be able to move `req.ip`.
    it('ignores a forged prefix and resolves the real client', async () => {
      // Three trusted hops + loopback socket, so the fourth-from-the-socket
      // entry is the real client and anything left of it is attacker-supplied.
      const res = await get(
        '203.0.113.99, 198.51.100.5, 192.0.2.1, 198.18.0.1',
      ).expect(200);

      expect(res.body.ip).toBe('198.51.100.5');
      expect(res.body.ip).not.toBe('203.0.113.99');
    });

    it('resolves two different clients to two different addresses', async () => {
      const [a, b] = await Promise.all([
        get('198.51.100.5, 192.0.2.1, 198.18.0.1').expect(200),
        get('198.51.100.77, 192.0.2.1, 198.18.0.1').expect(200),
      ]);

      expect(a.body.ip).toBe('198.51.100.5');
      expect(b.body.ip).toBe('198.51.100.77');
      expect(a.body.ip).not.toBe(b.body.ip);
    });

    // `getTracker` prefers `req.ips[0]`, which is empty until trust proxy is set.
    it('populates req.ips, which the throttler keys on', async () => {
      const res = await get('198.51.100.5, 192.0.2.1, 198.18.0.1').expect(200);

      expect(res.body.ips.length).toBeGreaterThan(0);
      expect(res.body.ips[0]).toBe('198.51.100.5');
    });

    // Documents the boundary rather than asserting it is safe: a hop count
    // trusts N entries whether or not N proxies appended them, so where the real
    // chain is shorter than TRUST_PROXY_HOPS — local dev, or any route that
    // bypasses Render's edge — the leftmost entry wins and a client can set its
    // own `req.ip`. That is exactly what production ran into under staging's
    // count (#2972). If this ever starts failing, the trust model changed and
    // #864 needs re-reading before the number is touched.
    it('over-trusts a chain shorter than the hop count (known boundary)', async () => {
      const res = await get('1.2.3.4').expect(200);

      expect(res.body.ip).toBe('1.2.3.4');
      expect(res.body.ips).toEqual(['1.2.3.4']);
    });

    it('falls back to the socket address when no chain is present', async () => {
      const res = await get().expect(200);

      expect(res.body.ips).toEqual([]);
      expect(res.body.ip).toBeDefined();
    });
  });

  describe('trust proxy per deployment (#2972)', () => {
    const apps: INestApplication[] = [];
    const appFor = async (environment: DeploymentEnvironment) => {
      const configured = await createConfiguredEchoApp(environment);
      apps.push(configured);
      return configured;
    };

    afterAll(async () => {
      await Promise.all(apps.map((configured) => configured.close()));
    });

    beforeEach(() => jest.mocked(createProxyChainTripwire).mockClear());

    // Production's proxies append two entries. Under staging's count of three
    // the forged value below was `req.ip`, and each rotation a fresh
    // rate-limit bucket.
    it('resolves the real client behind a forged prefix on production’s two-hop chain', async () => {
      const prod = await appFor('production');

      const res = await request(prod.getHttpServer())
        .get('/v1/echo')
        // forged, real client, the one proxy that appends before the socket
        .set('X-Forwarded-For', '203.0.113.99, 198.51.100.5, 192.0.2.1')
        .expect(200);

      expect(res.body.ip).toBe('198.51.100.5');
      expect(res.body.ips[0]).toBe('198.51.100.5');
    });

    it.each([
      ['production', 2],
      ['staging', 3],
    ] as const)(
      'arms the chain tripwire on %s with its own count',
      async (environment, hops) => {
        const configured = await appFor(environment);

        const instance = configured
          .getHttpAdapter()
          .getInstance<{ get: (setting: string) => unknown }>();
        expect(instance.get('trust proxy')).toBe(hops);
        expect(createProxyChainTripwire).toHaveBeenCalledWith(hops);
      },
    );

    it('does not arm it locally, where every chain is shorter than the count', async () => {
      await appFor('local');

      expect(createProxyChainTripwire).not.toHaveBeenCalled();
    });
  });

  describe('CORS origins per deployment (#2507)', () => {
    const apps = new Map<DeploymentEnvironment, INestApplication>();

    beforeAll(async () => {
      for (const environment of ['production', 'staging', 'local'] as const) {
        apps.set(environment, await createConfiguredEchoApp(environment));
      }
    });

    afterAll(async () => {
      await Promise.all(
        [...apps.values()].map((configured) => configured.close()),
      );
    });

    const allowOrigin = async (
      environment: DeploymentEnvironment,
      origin: string,
    ) => {
      const configured = apps.get(environment) as INestApplication;
      const res = await request(configured.getHttpServer())
        .options('/v1/echo')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);
      return res.headers['access-control-allow-origin'] as string | undefined;
    };

    it.each([
      ['production', 'https://app.frapp.live'],
      ['staging', 'https://app.staging.frapp.live'],
      ['staging', 'http://localhost:3000'],
      ['local', 'http://localhost:3000'],
      ['local', 'http://localhost:3002'],
    ] as const)('%s admits %s', async (environment, origin) => {
      expect(await allowOrigin(environment, origin)).toBe(origin);
    });

    // The acceptance criterion: production stops trusting the staging
    // dashboard, and every other `*.frapp.live` host the old pattern let in.
    it.each([
      ['production', 'https://app.staging.frapp.live'],
      ['production', 'https://staging.frapp.live'],
      ['production', 'https://docs.frapp.live'],
      ['production', 'https://frapp.live'],
      ['production', 'http://localhost:3000'],
      ['staging', 'https://app.frapp.live'],
      ['local', 'https://app.frapp.live'],
      ['local', 'https://app.staging.frapp.live'],
    ] as const)('%s refuses %s', async (environment, origin) => {
      expect(await allowOrigin(environment, origin)).toBeUndefined();
    });
  });

  describe('security headers (#483)', () => {
    it('sets standard hardening headers on every response', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/echo')
        .expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
      // Helmet's default frameguard sends this deprecated header alongside CSP's
      // frame-ancestors; both are asserted so a config change that drops either
      // protection is caught.
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      // The exact value, not just presence — `toBeDefined()` would still pass
      // if a future change set `hsts: { maxAge: 0 }` and neutered it.
      expect(res.headers['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains',
      );
      // Helmet's whole point includes NOT advertising the framework — this is
      // the header a default Express/Nest app sends and Helmet suppresses.
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('leaves CSP at Helmet defaults — Swagger needs no exception (#483)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/echo')
        .expect(200);

      // Exact match, not `toContain`: a substring check would still pass if a
      // future change widened e.g. script-src to add a remote origin, which is
      // exactly the regression a CSP test exists to catch. This is Helmet's
      // *unmodified* default — see the HELMET_OPTIONS comment in bootstrap.ts
      // for why Swagger UI already fits inside it without any directive
      // override (verified by a live /docs boot, recorded in
      // docs/security/security-fixes.md).
      expect(res.headers['content-security-policy']).toBe(
        "default-src 'self';base-uri 'self';font-src 'self' https: data:;" +
          "form-action 'self';frame-ancestors 'self';img-src 'self' data:;" +
          "object-src 'none';script-src 'self';script-src-attr 'none';" +
          "style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
      );
    });

    it('sets Cross-Origin-Resource-Policy to cross-origin, not Helmet’s same-origin default', async () => {
      // The one directive this API does override, and the one a plain
      // `helmet()` call would have gotten wrong here: Helmet defaults
      // Cross-Origin-Resource-Policy to 'same-origin', which Chrome/Firefox
      // enforce independently of CORS — supertest never enforces it, so this
      // is the only place a regression would be caught before production. Left
      // at the default, this would silently break every dashboard fetch() to
      // this API (api.frapp.live vs app.frapp.live are different origins).
      const res = await request(app.getHttpServer())
        .get('/v1/echo')
        .expect(200);

      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('runs as global middleware, ahead of routing — not skipped for an unmatched route', async () => {
      // A 404 from a route that does not exist never reaches EchoController.
      // This proves Helmet is registered as Express middleware that sees every
      // request, not scoped to matched routes the way a Nest guard or
      // interceptor would be — it does not by itself prove anything about
      // relative ordering against requestIdMiddleware or AllExceptionsFilter,
      // both of which also run unconditionally.
      const res = await request(app.getHttpServer())
        .get('/v1/does-not-exist')
        .expect(404);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('CORS request and trace headers', () => {
    const DASHBOARD_ORIGIN = 'http://localhost:3000';

    it('exposes x-request-id, sentry-trace, and baggage to an allowed origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/echo')
        .set('Origin', DASHBOARD_ORIGIN)
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(headerList(res.headers['access-control-expose-headers'])).toEqual(
        expect.arrayContaining([
          'x-request-id',
          'sentry-trace',
          'baggage',
          'x-report-truncated',
          'x-search-timeout',
        ]),
      );
    });

    it('echoes a caller-supplied request id and does not replace it with sentry-trace', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/echo')
        .set('Origin', DASHBOARD_ORIGIN)
        .set('x-request-id', 'client-req-cors-1')
        .set(
          'sentry-trace',
          '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        )
        .set('baggage', 'sentry-environment=test')
        .expect(200);

      expect(res.headers['x-request-id']).toBe('client-req-cors-1');
      expect(res.headers['x-request-id']).not.toContain('aaaaaaaa');
    });

    it('mints a request id when the client sent none, even if trace headers are present', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/echo')
        .set('Origin', DASHBOARD_ORIGIN)
        .set(
          'sentry-trace',
          '00-cccccccccccccccccccccccccccccccc-dddddddddddddddd-01',
        )
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN);
      expect(res.headers['x-request-id']).toMatch(/^req_[0-9a-f-]{36}$/);
      expect(res.headers['x-request-id']).not.toContain('cccccccc');
    });

    it('reflects request-id and trace headers on preflight', async () => {
      const res = await request(app.getHttpServer())
        .options('/v1/echo')
        .set('Origin', DASHBOARD_ORIGIN)
        .set('Access-Control-Request-Method', 'GET')
        .set(
          'Access-Control-Request-Headers',
          'x-request-id,sentry-trace,baggage',
        )
        .expect(204);

      expect(headerList(res.headers['access-control-allow-headers'])).toEqual(
        expect.arrayContaining(['x-request-id', 'sentry-trace', 'baggage']),
      );
    });

    it('does not allow a lookalike origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/echo')
        .set('Origin', 'https://frapp.live.attacker.example')
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('PostHog log records are emitted inside their request (#2374)', () => {
    // The runtime samples on the request id it reads from AsyncLocalStorage,
    // so a request's records share one verdict only if the store is still
    // bound when the interceptor and the filter emit them.
    let boundIds: Array<string | undefined>;

    beforeEach(() => {
      boundIds = [];
      jest.mocked(enqueueSanitizedLog).mockImplementation(() => {
        boundIds.push(getRequestId());
      });
    });

    afterEach(() => {
      jest.mocked(enqueueSanitizedLog).mockReset();
    });

    it.each([
      ['a matched route, via the interceptor', '/v1/echo', 200],
      ['an unmatched route, via the filter', '/v1/no-such-route', 404],
    ])('binds the request id for %s', async (_label, path, status) => {
      await request(app.getHttpServer())
        .get(path)
        .set('x-request-id', 'req-sampled-together')
        .expect(status);

      expect(boundIds).toEqual(['req-sampled-together']);
    });
  });

  describe('unmatched 4xx reach PostHog Logs (#2078)', () => {
    beforeEach(() => {
      jest.mocked(enqueueSanitizedLog).mockClear();
    });

    it('emits a sanitized request log for GET /v1/ws8-synthetic-no-content', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/ws8-synthetic-no-content?email=member@example.com')
        .set('x-request-id', 'req-ws8-unmatched')
        .expect(404);

      expect(res.body).toMatchObject({
        statusCode: 404,
        requestId: 'req-ws8-unmatched',
      });

      const requestLogs = jest
        .mocked(enqueueSanitizedLog)
        .mock.calls.filter(
          (call) => (call[0] as { body?: string }).body === 'request',
        );
      expect(requestLogs).toHaveLength(1);
      const [record] = requestLogs[0] as [
        { attributes: Record<string, unknown> },
      ];
      expect(record.attributes).toMatchObject({
        request_id: 'req-ws8-unmatched',
        method: 'GET',
        path: '/v1/ws8-synthetic-no-content',
        status_code: 404,
        status_class: '4xx',
      });
      const serialized = JSON.stringify(requestLogs);
      expect(serialized).not.toContain('member@example.com');
      expect(serialized).not.toContain('Cannot GET');
    });
  });
});
