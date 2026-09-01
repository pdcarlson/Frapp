import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { configureApp, TRUST_PROXY_HOPS } from './bootstrap';

/** Echoes what Express resolved, so the assertions read the real resolution. */
@Controller('echo')
class EchoController {
  @Get()
  echo(@Req() req: Request): { ip?: string; ips: string[] } {
    return { ip: req.ip, ips: req.ips };
  }
}

describe('configureApp — trust proxy (#864)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (xff?: string) => {
    const req = request(app.getHttpServer()).get('/v1/echo');
    return xff === undefined ? req : req.set('X-Forwarded-For', xff);
  };

  it('sets the measured hop count on the Express instance', () => {
    const instance = app
      .getHttpAdapter()
      .getInstance<{ get: (setting: string) => unknown }>();

    expect(instance.get('trust proxy')).toBe(TRUST_PROXY_HOPS);
    expect(TRUST_PROXY_HOPS).toBe(3);
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
  // own `req.ip`. Deployed traffic always carries the measured three (#864).
  // If this ever starts failing, the trust model changed and #864 needs
  // re-reading before the number is touched.
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

describe('configureApp — security headers (#483)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sets standard hardening headers on every response', async () => {
    const res = await request(app.getHttpServer()).get('/v1/echo').expect(200);

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
    const res = await request(app.getHttpServer()).get('/v1/echo').expect(200);

    // Exact match, not `toContain`: a substring check would still pass if a
    // future change widened e.g. script-src to add a remote origin, which is
    // exactly the regression a CSP test exists to catch. This is Helmet's
    // *unmodified* default — see the HELMET_OPTIONS comment in bootstrap.ts
    // for why Swagger UI already fits inside it without any directive
    // override (verified by a live /docs boot, recorded in
    // docs/internal/security/SECURITY_FIXES.md).
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
    const res = await request(app.getHttpServer()).get('/v1/echo').expect(200);

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
