import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ThrottlerException,
  ThrottlerLimitDetail,
  ThrottlerRequest,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';
import { createHmac } from 'node:crypto';
import {
  CustomThrottlerGuard,
  READ_THROTTLE_METHODS,
} from './custom-throttler.guard';
import { WebhookController } from '../controllers/webhook.controller';
import { ReportController } from '../controllers/report.controller';
import { SearchController } from '../controllers/search.controller';
import { InviteController } from '../controllers/invite.controller';
import { EventController } from '../controllers/event.controller';
import { ChapterDocumentController } from '../controllers/chapter-document.controller';
import { BackworkController } from '../controllers/backwork.controller';
import { ChatController } from '../controllers/chat.controller';
import { ChapterController } from '../controllers/chapter.controller';
import { ServiceEntryController } from '../controllers/service-entry.controller';
import { UserController } from '../controllers/user.controller';

// Expose the protected members under test.
class TestableGuard extends CustomThrottlerGuard {
  public track(req: Record<string, any>): Promise<string> {
    return this.getTracker(req);
  }
  public handle(props: ThrottlerRequest): Promise<boolean> {
    return this.handleRequest(props);
  }
  public throwThrottling(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    return this.throwThrottlingException(context, detail);
  }
}

const TEST_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';

const b64url = (obj: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Build a JWT signed (HS256) with `secret`, unless `secret` is null (then a
 * bogus signature is used to model a forged token). */
const makeJwt = (
  payload: Record<string, unknown>,
  secret: string | null = TEST_SECRET,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string => {
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature =
    secret === null
      ? 'forged-signature'
      : createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
};

const futureExp = () => Math.floor(Date.now() / 1000) + 3600;

describe('CustomThrottlerGuard', () => {
  let guard: TestableGuard;

  beforeEach(async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
    // Build the guard through Nest DI (rather than `new`) so its inherited
    // ThrottlerGuard constructor wiring is exercised and a future
    // constructor/provider regression would surface here.
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TestableGuard,
        Reflector,
        { provide: getOptionsToken(), useValue: [] },
        { provide: getStorageToken(), useValue: { increment: jest.fn() } },
      ],
    }).compile();
    guard = moduleRef.get(TestableGuard);
  });

  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
  });

  describe('getTracker', () => {
    it('keys on the sub of a validly signed token', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${makeJwt({ sub: 'user-123', exp: futureExp() })}`,
        },
        ip: '10.0.0.1',
      };
      await expect(guard.track(req)).resolves.toBe('user:user-123');
    });

    it('handles a header delivered as an array', async () => {
      const req = {
        headers: {
          authorization: [
            `Bearer ${makeJwt({ sub: 'user-9', exp: futureExp() })}`,
          ],
        },
        ip: '10.0.0.1',
      };
      await expect(guard.track(req)).resolves.toBe('user:user-9');
    });

    it('falls back to IP for a forged (bad-signature) token — the bypass is closed', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${makeJwt({ sub: 'attacker', exp: futureExp() }, null)}`,
        },
        ip: '203.0.113.1',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.1');
    });

    it('falls back to IP for a token signed with the wrong secret', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${makeJwt({ sub: 'x', exp: futureExp() }, 'some-other-secret-value-not-ours-32xx')}`,
        },
        ip: '203.0.113.2',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.2');
    });

    it('falls back to IP for an expired token', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${makeJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 10 })}`,
        },
        ip: '203.0.113.3',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.3');
    });

    it('falls back to IP for a validly signed token with no exp claim', async () => {
      const req = {
        headers: { authorization: `Bearer ${makeJwt({ sub: 'user-1' })}` },
        ip: '203.0.113.6',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.6');
    });

    it('rejects a non-HS256 alg even if the signature segment matches', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${makeJwt({ sub: 'user-1', exp: futureExp() }, TEST_SECRET, { alg: 'none', typ: 'JWT' })}`,
        },
        ip: '203.0.113.4',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.4');
    });

    it('falls back to IP when no secret is configured, even for a valid token', async () => {
      delete process.env.SUPABASE_JWT_SECRET;
      const req = {
        headers: {
          authorization: `Bearer ${makeJwt({ sub: 'user-1', exp: futureExp() })}`,
        },
        ip: '203.0.113.5',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.5');
    });

    it('falls back to IP when there is no Authorization header', async () => {
      await expect(
        guard.track({ headers: {}, ip: '203.0.113.7' }),
      ).resolves.toBe('ip:203.0.113.7');
    });

    // #864 AC 4. Before `trust proxy` was set, `req.ips` was always empty
    // behind Render and `req.ip` was the proxy, so every unauthenticated
    // caller collapsed into one bucket. With the measured hop count in
    // `configureApp`, two callers key separately — which is the whole point of
    // the rate limit, and of the auth-failure spike detector that shares the
    // tracker.
    it('buckets two different forwarded clients separately', async () => {
      const trackerFor = (clientIp: string) =>
        guard.track({
          headers: {},
          ips: [clientIp, '192.0.2.1'],
          ip: clientIp,
        });

      const [first, second] = await Promise.all([
        trackerFor('198.51.100.5'),
        trackerFor('198.51.100.77'),
      ]);

      expect(first).toBe('ip:198.51.100.5');
      expect(second).toBe('ip:198.51.100.77');
      expect(first).not.toBe(second);
    });

    it('keeps one client in one bucket across repeated requests', async () => {
      const req = { headers: {}, ips: ['198.51.100.5', '192.0.2.1'] };

      await expect(guard.track(req)).resolves.toBe('ip:198.51.100.5');
      await expect(guard.track(req)).resolves.toBe('ip:198.51.100.5');
    });

    it('prefers the first forwarded IP when present', async () => {
      const req = {
        headers: {},
        ips: ['198.51.100.4', '10.0.0.1'],
        ip: '10.0.0.1',
      };
      await expect(guard.track(req)).resolves.toBe('ip:198.51.100.4');
    });

    it('falls back to IP for a structurally malformed bearer token', async () => {
      const req = {
        headers: { authorization: 'Bearer not-a-jwt' },
        ip: '203.0.113.9',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.9');
    });

    it('falls back to IP when a validly signed token has no sub', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${makeJwt({ role: 'admin', exp: futureExp() })}`,
        },
        ip: '203.0.113.10',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.10');
    });

    it('ignores a non-Bearer Authorization scheme', async () => {
      const req = {
        headers: { authorization: 'Basic abc123' },
        ip: '203.0.113.11',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.11');
    });
  });

  describe('handleRequest method gating', () => {
    const ctxFor = (method: string): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ method }) }),
      }) as unknown as ExecutionContext;

    const props = (name: string, method: string): ThrottlerRequest =>
      ({
        context: ctxFor(method),
        throttler: { name },
      }) as unknown as ThrottlerRequest;

    it('skips the write throttler for read methods', async () => {
      await expect(guard.handle(props('write', 'GET'))).resolves.toBe(true);
    });

    it('skips the read throttler for write methods', async () => {
      await expect(guard.handle(props('read', 'POST'))).resolves.toBe(true);
    });
  });

  describe('named-throttler skip (webhook exemption)', () => {
    // These tests pin the FRA-275 exemption end-to-end through canActivate:
    // the @SkipThrottle({ read, write }) keys on WebhookController must match
    // the named throttlers registered in AppModule. A bare @SkipThrottle()
    // sets only the `default` key and silently fails to skip — the exact
    // regression this suite exists to catch.
    class UndecoratedController {
      handle(): void {}
    }

    let skipGuard: TestableGuard;
    let increment: jest.Mock;

    const httpCtx = (
      cls: new (...args: never[]) => unknown,
      handler: (...args: never[]) => unknown,
    ): ExecutionContext =>
      ({
        getClass: () => cls,
        getHandler: () => handler,
        switchToHttp: () => ({
          getRequest: () => ({ method: 'POST', headers: {}, ip: '1.2.3.4' }),
          getResponse: () => ({ header: jest.fn() }),
        }),
      }) as unknown as ExecutionContext;

    beforeEach(async () => {
      increment = jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          TestableGuard,
          Reflector,
          {
            provide: getOptionsToken(),
            useValue: [
              { name: 'read', ttl: 60_000, limit: 100 },
              { name: 'write', ttl: 60_000, limit: 30 },
            ],
          },
          { provide: getStorageToken(), useValue: { increment } },
        ],
      }).compile();
      skipGuard = moduleRef.get(TestableGuard);
      await skipGuard.onModuleInit();
    });

    it('never counts Stripe webhook requests against any bucket', async () => {
      const ctx = httpCtx(
        WebhookController,
        WebhookController.prototype.handleStripeWebhook,
      );
      await expect(skipGuard.canActivate(ctx)).resolves.toBe(true);
      expect(increment).not.toHaveBeenCalled();
    });

    it('still counts undecorated POST routes against the write bucket', async () => {
      const ctx = httpCtx(
        UndecoratedController,
        UndecoratedController.prototype.handle,
      );
      await expect(skipGuard.canActivate(ctx)).resolves.toBe(true);
      // Exactly once: the write throttler increments; the read throttler is
      // method-gated off for POST by handleRequest.
      expect(increment).toHaveBeenCalledTimes(1);
    });
  });

  // #850. These pin the per-route limits themselves, not the mechanism: each
  // case names a real controller handler and the limit it must reach the
  // storage with, so deleting a `@Throttle*` decorator — or moving a route
  // between HTTP methods, which silently changes which bucket applies — turns
  // this suite red instead of quietly restoring the 30/min default.
  describe('per-route throttle overrides', () => {
    interface RouteCase {
      /** `"<METHOD> <path>"` — the method half drives the request and bucket. */
      route: string;
      cls: new (...args: never[]) => unknown;
      handler: (...args: never[]) => unknown;
      limit: number;
    }

    /**
     * Cases carry no explicit bucket: which one applies is *derived* from the
     * HTTP method, exactly as `handleRequest` derives it. Stating it separately
     * would let a case assert a method/bucket pair the guard would never
     * produce, and the test would still pass.
     */
    const bucketFor = (method: string): 'read' | 'write' =>
      READ_THROTTLE_METHODS.has(method) ? 'read' : 'write';

    const route = (
      r: string,
      cls: new (...args: never[]) => unknown,
      handler: (...args: never[]) => unknown,
      limit: number,
    ): RouteCase => ({ route: r, cls, handler, limit });

    const RP = ReportController.prototype;
    const IN = InviteController.prototype;
    const EV = EventController.prototype;
    const CD = ChapterDocumentController.prototype;
    const BW = BackworkController.prototype;
    const CT = ChatController.prototype;
    const CP = ChapterController.prototype;
    const SE = ServiceEntryController.prototype;
    const US = UserController.prototype;
    const SR = SearchController.prototype;

    const cases: RouteCase[] = [
      route('POST /reports/attendance', ReportController, RP.attendance, 5),
      route('POST /reports/points', ReportController, RP.points, 5),
      route('POST /reports/roster', ReportController, RP.roster, 5),
      route('POST /reports/service', ReportController, RP.service, 5),
      route('POST /invites/batch', InviteController, IN.createBatch, 5),
      route('POST /invites/redeem', InviteController, IN.redeem, 10),
      route('POST /events', EventController, EV.create, 10),
      route('PATCH /events/:id', EventController, EV.update, 10),
      route(
        'POST /documents/upload-url',
        ChapterDocumentController,
        CD.requestUploadUrl,
        10,
      ),
      route(
        'POST /backwork/upload-url',
        BackworkController,
        BW.requestUploadUrl,
        10,
      ),
      route(
        'POST /channels/:id/upload-url',
        ChatController,
        CT.requestUploadUrl,
        10,
      ),
      route(
        'POST /chapters/current/logo-url',
        ChapterController,
        CP.requestLogoUploadUrl,
        10,
      ),
      route(
        'POST /service-entries/proof-upload-url',
        ServiceEntryController,
        SE.requestProofUploadUrl,
        10,
      ),
      route(
        'POST /users/me/avatar-url',
        UserController,
        US.requestAvatarUploadUrl,
        10,
      ),
      route('GET /search', SearchController, SR.search, 20),
    ];

    let overrideGuard: TestableGuard;
    let increment: jest.Mock;

    const ctxFor = (c: RouteCase): ExecutionContext =>
      ({
        getClass: () => c.cls,
        getHandler: () => c.handler,
        switchToHttp: () => ({
          getRequest: () => ({
            method: c.route.split(' ')[0],
            headers: {},
            ip: '1.2.3.4',
          }),
          getResponse: () => ({ header: jest.fn() }),
        }),
      }) as unknown as ExecutionContext;

    beforeEach(async () => {
      increment = jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          TestableGuard,
          Reflector,
          {
            provide: getOptionsToken(),
            useValue: [
              { name: 'read', ttl: 60_000, limit: 100 },
              { name: 'write', ttl: 60_000, limit: 30 },
            ],
          },
          { provide: getStorageToken(), useValue: { increment } },
        ],
      }).compile();
      overrideGuard = moduleRef.get(TestableGuard);
      await overrideGuard.onModuleInit();
    });

    it.each(cases)('$route is capped at $limit/min', async (c) => {
      await expect(overrideGuard.canActivate(ctxFor(c))).resolves.toBe(true);

      // Exactly one bucket runs: the other is method-gated off. Asserting the
      // count as well as the args is what catches a profile applied to the
      // wrong bucket (e.g. a `read` profile on a POST route), which would
      // leave the route on the untouched 30/min default with no other symptom.
      expect(increment).toHaveBeenCalledTimes(1);
      // increment(key, ttl, limit, blockDuration, throttlerName)
      expect(increment).toHaveBeenCalledWith(
        expect.any(String),
        60_000,
        c.limit,
        60_000,
        bucketFor(c.route.split(' ')[0]),
      );
    });

    it('throws 429 once the storage reports the override exhausted', async () => {
      increment.mockResolvedValue({
        totalHits: 6,
        timeToExpire: 60,
        isBlocked: true,
        timeToBlockExpire: 31,
      });

      await expect(
        overrideGuard.canActivate(ctxFor(cases[0])),
      ).rejects.toBeInstanceOf(ThrottlerException);
    });

    it('leaves undecorated routes on the default write limit', async () => {
      class UndecoratedController {
        handle(): void {}
      }
      await expect(
        overrideGuard.canActivate(
          ctxFor(
            route(
              'POST /undecorated',
              UndecoratedController,
              UndecoratedController.prototype.handle,
              30,
            ),
          ),
        ),
      ).resolves.toBe(true);
      expect(increment).toHaveBeenCalledWith(
        expect.any(String),
        60_000,
        30,
        60_000,
        'write',
      );
    });

    it('gives each handler its own counter key', async () => {
      // The per-handler key is what makes a route-level limit meaningful; if
      // keys collapsed, the 5/min on one report route would be shared by all
      // four and this file's whole premise would be wrong.
      await overrideGuard.canActivate(ctxFor(cases[0]));
      await overrideGuard.canActivate(ctxFor(cases[1]));

      const [firstKey] = increment.mock.calls[0] as [string];
      const [secondKey] = increment.mock.calls[1] as [string];
      expect(firstKey).not.toEqual(secondKey);
    });
  });

  describe('throwThrottlingException', () => {
    it('sets a standard Retry-After header before throwing', async () => {
      const header = jest.fn();
      const context = {
        switchToHttp: () => ({ getResponse: () => ({ header }) }),
        getClass: () => class {},
        getHandler: () => () => undefined,
      } as unknown as ExecutionContext;
      const detail = {
        timeToBlockExpire: 42,
      } as unknown as ThrottlerLimitDetail;

      await expect(
        guard.throwThrottling(context, detail),
      ).rejects.toBeInstanceOf(ThrottlerException);
      expect(header).toHaveBeenCalledWith('Retry-After', '42');
    });
  });
});
