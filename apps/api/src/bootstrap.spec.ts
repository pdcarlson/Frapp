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
    expect(res.headers['strict-transport-security']).toBeDefined();
    // Helmet's whole point includes NOT advertising the framework — this is
    // the header a default Express/Nest app sends and Helmet suppresses.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('relaxes CSP script-src/style-src for Swagger UI’s inlined bundle, not beyond it', async () => {
    const res = await request(app.getHttpServer()).get('/v1/echo').expect(200);
    const csp = res.headers['content-security-policy'];

    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    // No wildcard or remote origin sneaks into the loosened directives.
    expect(csp).not.toMatch(/script-src[^;]*\*/);
  });

  it('applies before request-id and the exception filter, so even a rejected request is covered', async () => {
    // A 404 from a route that does not exist never reaches EchoController, so
    // this proves the header comes from middleware registered ahead of
    // routing rather than from the handler.
    const res = await request(app.getHttpServer())
      .get('/v1/does-not-exist')
      .expect(404);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
