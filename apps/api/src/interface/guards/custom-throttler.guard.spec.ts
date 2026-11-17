import { ExecutionContext, Logger } from '@nestjs/common';
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
  JWKS_REFRESH_INTERVAL_MS,
  READ_THROTTLE_METHODS,
  THROTTLED_MESSAGE,
  UNVERIFIED_BEARER_LIMIT,
  UNVERIFIED_BEARER_THROTTLER,
  UNVERIFIED_BEARER_TTL_MS,
  UNVERIFIED_LIMIT_AUTH_CODE,
  clientAddress,
} from './custom-throttler.guard';
import {
  AuthRejectedException,
  INVALID_TOKEN_MESSAGE,
} from './auth-rejected.exception';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { WebhookController } from '../controllers/webhook.controller';
import { ReportController } from '../controllers/report.controller';
import { SearchController } from '../controllers/search.controller';
import { DevLogController } from '../controllers/dev-log.controller';
import { InviteController } from '../controllers/invite.controller';
import { ActController } from '../controllers/act.controller';
import { EventController } from '../controllers/event.controller';
import { AskController } from '../controllers/ask.controller';
import { ChatCatchUpController } from '../controllers/chat-catch-up.controller';
import { ChapterDocumentController } from '../controllers/chapter-document.controller';
import { BackworkController } from '../controllers/backwork.controller';
import { ChatController } from '../controllers/chat.controller';
import { ChapterController } from '../controllers/chapter.controller';
import { TaskController } from '../controllers/task.controller';
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

    it('falls back to IP for a token whose header decodes to JSON null, instead of throwing', async () => {
      const nullHeader = Buffer.from('null').toString('base64url');
      const req = {
        headers: { authorization: `Bearer ${nullHeader}.e30.x` },
        ip: '203.0.113.9',
      };
      await expect(guard.track(req)).resolves.toBe('ip:203.0.113.9');
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

    // A device on an IPv6 network can pick a fresh address inside its /64 for
    // every request, so the /64 is what one network is keyed on.
    it('keys IPv6 callers on their /64, and IPv4 ones unchanged', async () => {
      const track = (ip: string) => guard.track({ headers: {}, ip });

      const [a, b, other] = await Promise.all([
        track('2001:db8:aa:bb:1111:2222:3333:4444'),
        track('2001:db8:aa:bb:9999:8888:7777:6666'),
        track('2001:db8:aa:cc::1'),
      ]);
      expect(a).toBe('ip:2001:db8:aa:bb::/64');
      expect(b).toBe(a);
      expect(other).not.toBe(a);

      await expect(track('::ffff:198.51.100.9')).resolves.toBe(
        'ip:198.51.100.9',
      );
      await expect(track('198.51.100.9')).resolves.toBe('ip:198.51.100.9');
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

  // Both hosted Frapp projects sign access tokens with ES256 (the HS256 secret
  // is `previously_used` on each), so the HS256 path above never keys a hosted
  // request per user. Asymmetric tokens go to `supabase.auth.getClaims()`,
  // handed the key the project's JWKS lists for their `kid`, which the guard
  // reads itself. The client and the JWKS are mocked here: what is under test
  // is the routing by `alg`, which keys reach the verifier, the trust placed
  // in its answer, and every failure landing in per-IP keying rather than a
  // rejection.
  describe('getTracker — asymmetric (ES256/RS256) tokens via JWKS', () => {
    let getClaims: jest.Mock;
    let jwksGuard: TestableGuard;
    let fetchSpy: jest.SpyInstance;
    let warn: jest.SpyInstance;

    const SERVICE_KEY = 'service-role-key-for-tests';
    const PROJECT_URL = 'https://project.example.test/';
    const JWKS_URL =
      'https://project.example.test/auth/v1/.well-known/jwks.json';
    const KEY_1 = { kid: 'key-1', kty: 'EC', alg: 'ES256' };
    const previousEnv = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    const jwksResponse = (body: unknown, ok = true, status = 200) =>
      ({
        ok,
        status,
        json: () => Promise.resolve(body),
      }) as unknown as Response;

    /** A token whose header names an asymmetric alg; the signature is opaque
     * to this guard — the verifier is what decides, and it is mocked. */
    const asymmetricJwt = (
      payload: Record<string, unknown>,
      alg: 'ES256' | 'RS256' = 'ES256',
      kid = 'key-1',
    ): string =>
      `${b64url({ alg, typ: 'JWT', kid })}.${b64url(payload)}.opaque-signature`;

    const buildGuard = async (): Promise<TestableGuard> => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          TestableGuard,
          Reflector,
          { provide: getOptionsToken(), useValue: [] },
          { provide: getStorageToken(), useValue: { increment: jest.fn() } },
          { provide: SUPABASE_CLIENT, useValue: { auth: { getClaims } } },
        ],
      }).compile();
      const built = moduleRef.get(TestableGuard);
      // Starts the boot read of the JWKS; requests wait for it.
      await built.onModuleInit();
      return built;
    };

    beforeEach(async () => {
      process.env.SUPABASE_URL = PROJECT_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jwksResponse({ keys: [KEY_1] }));
      warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      getClaims = jest.fn();
      jwksGuard = await buildGuard();
    });

    afterEach(() => {
      fetchSpy.mockRestore();
      warn.mockRestore();
      for (const [name, value] of [
        ['SUPABASE_URL', previousEnv.url],
        ['SUPABASE_SERVICE_ROLE_KEY', previousEnv.key],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it('keys on the sub the verifier returns for an ES256 token', async () => {
      const token = asymmetricJwt({
        sub: 'ignored-by-guard',
        exp: futureExp(),
      });
      getClaims.mockResolvedValue({
        data: { claims: { sub: 'user-es256', exp: futureExp() } },
        error: null,
      });
      await expect(
        jwksGuard.track({
          headers: { authorization: `Bearer ${token}` },
          ip: '203.0.113.20',
        }),
      ).resolves.toBe('user:user-es256');
      // The whole compact token goes to the verifier, untouched, with the one
      // key the project lists for its `kid`, so the check never fetches.
      expect(getClaims).toHaveBeenCalledWith(token, {
        jwks: { keys: [KEY_1] },
      });
    });

    // `SupabaseAuthGuard` starts the chapter lookups on these while `getUser`
    // runs (#3728), so they must be exactly what was verified, and nothing
    // when verification did not happen.
    it('leaves the claims it verified on the request, and none it did not', async () => {
      const claims = {
        sub: 'user-es256',
        exp: futureExp(),
        active_chapter_id: 'chapter-1',
      };
      getClaims.mockResolvedValueOnce({ data: { claims }, error: null });
      const verified: Record<string, unknown> = {
        headers: {
          authorization: `Bearer ${asymmetricJwt({ exp: futureExp() })}`,
        },
        ip: '203.0.113.30',
      };
      await jwksGuard.track(verified);
      expect(verified.throttlerVerifiedClaims).toEqual(claims);

      getClaims.mockResolvedValueOnce({
        data: null,
        error: { message: 'invalid signature', code: 'invalid_jwt' },
      });
      const rejected: Record<string, unknown> = {
        headers: {
          authorization: `Bearer ${asymmetricJwt({ exp: futureExp() })}`,
        },
        ip: '203.0.113.31',
      };
      await jwksGuard.track(rejected);
      expect(rejected).not.toHaveProperty('throttlerVerifiedClaims');

      getClaims.mockResolvedValueOnce({
        data: { claims: { sub: 'user-es256', exp: 1 } },
        error: null,
      });
      const expired: Record<string, unknown> = {
        headers: {
          authorization: `Bearer ${asymmetricJwt({ exp: futureExp() })}`,
        },
        ip: '203.0.113.32',
      };
      await jwksGuard.track(expired);
      expect(expired).not.toHaveProperty('throttlerVerifiedClaims');
    });

    it('accepts RS256 through the same verifier', async () => {
      getClaims.mockResolvedValue({
        data: { claims: { sub: 'user-rs256', exp: futureExp() } },
        error: null,
      });
      await expect(
        jwksGuard.track({
          headers: {
            authorization: `Bearer ${asymmetricJwt({ sub: 'x', exp: futureExp() }, 'RS256')}`,
          },
          ip: '203.0.113.21',
        }),
      ).resolves.toBe('user:user-rs256');
    });

    it('falls back to IP when the verifier rejects the token', async () => {
      getClaims.mockResolvedValue({
        data: null,
        error: { message: 'invalid signature', code: 'invalid_jwt' },
      });
      await expect(
        jwksGuard.track({
          headers: {
            authorization: `Bearer ${asymmetricJwt({ sub: 'attacker', exp: futureExp() })}`,
          },
          ip: '203.0.113.22',
        }),
      ).resolves.toBe('ip:203.0.113.22');
    });

    it('falls back to IP when the verifier throws', async () => {
      getClaims.mockRejectedValue(new Error('crypto failure'));
      await expect(
        jwksGuard.track({
          headers: {
            authorization: `Bearer ${asymmetricJwt({ sub: 'u', exp: futureExp() })}`,
          },
          ip: '203.0.113.23',
        }),
      ).resolves.toBe('ip:203.0.113.23');
    });

    it('falls back to IP when the verified claims carry an expired or missing exp', async () => {
      getClaims.mockResolvedValueOnce({
        data: {
          claims: { sub: 'u', exp: Math.floor(Date.now() / 1000) - 60 },
        },
        error: null,
      });
      await expect(
        jwksGuard.track({
          headers: {
            authorization: `Bearer ${asymmetricJwt({ sub: 'u', exp: futureExp() })}`,
          },
          ip: '203.0.113.24',
        }),
      ).resolves.toBe('ip:203.0.113.24');

      getClaims.mockResolvedValueOnce({
        data: { claims: { sub: 'u' } },
        error: null,
      });
      await expect(
        jwksGuard.track({
          headers: {
            authorization: `Bearer ${asymmetricJwt({ sub: 'u' })}`,
          },
          ip: '203.0.113.25',
        }),
      ).resolves.toBe('ip:203.0.113.25');
      expect(getClaims).toHaveBeenCalledTimes(2);
    });

    it('never sends a token whose own exp has passed to the verifier', async () => {
      await expect(
        jwksGuard.track({
          headers: {
            authorization: `Bearer ${asymmetricJwt({ sub: 'u', exp: 1 })}`,
          },
          ip: '203.0.113.29',
        }),
      ).resolves.toBe('ip:203.0.113.29');
      expect(getClaims).not.toHaveBeenCalled();
    });

    it('never sends an HS256 token to the JWKS verifier', async () => {
      await expect(
        jwksGuard.track({
          headers: {
            authorization: `Bearer ${makeJwt({ sub: 'user-hs', exp: futureExp() })}`,
          },
          ip: '203.0.113.26',
        }),
      ).resolves.toBe('user:user-hs');
      expect(getClaims).not.toHaveBeenCalled();
    });

    it('never sends alg=none or an unknown alg to the JWKS verifier', async () => {
      for (const alg of ['none', 'HS512', 'PS256']) {
        await expect(
          jwksGuard.track({
            headers: {
              authorization: `Bearer ${b64url({ alg, typ: 'JWT' })}.${b64url({ sub: 'u', exp: futureExp() })}.sig`,
            },
            ip: '203.0.113.27',
          }),
        ).resolves.toBe('ip:203.0.113.27');
      }
      expect(getClaims).not.toHaveBeenCalled();
    });

    it('verifies a request once however many throttlers ask for its tracker', async () => {
      getClaims.mockResolvedValue({
        data: { claims: { sub: 'member-a', exp: futureExp() } },
        error: null,
      });
      const req = {
        headers: {
          authorization: `Bearer ${asymmetricJwt({ exp: futureExp() })}`,
        },
        ip: '203.0.113.36',
      };
      await expect(jwksGuard.track(req)).resolves.toBe('user:member-a');
      await expect(jwksGuard.track(req)).resolves.toBe('user:member-a');
      expect(getClaims).toHaveBeenCalledTimes(1);
    });

    // supabase-js fetches the JWKS for a `kid` it has not cached, and asks
    // Supabase Auth about a token whose `kid` the JWKS does not list; this
    // guard runs before authentication. So the guard reads the project's
    // JWKS itself, hands the verifier only a key from it, and for a `kid` it
    // does not hold re-reads the JWKS, one read at a time and at most once
    // per interval, learning every key the project lists.
    describe("the project's signing keys", () => {
      const withKid = (kid: string): string =>
        asymmetricJwt({ sub: 'u', exp: futureExp() }, 'ES256', kid);
      const reqFor = (kid: string, ip = '203.0.113.40') => ({
        headers: { authorization: `Bearer ${withKid(kid)}` },
        ip,
      });

      let nowSpy: jest.SpyInstance<number, []>;
      let now: number;

      beforeEach(async () => {
        now = 1_800_000_000_000;
        nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
        // Rebuilt under the mocked clock, so its boot read's interval is on it.
        fetchSpy.mockClear();
        jwksGuard = await buildGuard();
        getClaims.mockResolvedValue({
          data: { claims: { sub: 'member-a', exp: futureExp() } },
          error: null,
        });
      });

      afterEach(() => {
        nowSpy.mockRestore();
      });

      it('reads the JWKS with the headers supabase-js sends for it', () => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy).toHaveBeenCalledWith(JWKS_URL, {
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          signal: expect.any(AbortSignal),
        });
      });

      it('never sends a kid the project does not list to the verifier, and re-reads at most once per interval', async () => {
        await expect(jwksGuard.track(reqFor('made-up-1'))).resolves.toBe(
          'ip:203.0.113.40',
        );
        await expect(jwksGuard.track(reqFor('made-up-2'))).resolves.toBe(
          'ip:203.0.113.40',
        );
        // The boot read, and nothing more inside its interval.
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        now += JWKS_REFRESH_INTERVAL_MS;
        await expect(jwksGuard.track(reqFor('made-up-3'))).resolves.toBe(
          'ip:203.0.113.40',
        );
        await expect(jwksGuard.track(reqFor('made-up-4'))).resolves.toBe(
          'ip:203.0.113.40',
        );
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(getClaims).not.toHaveBeenCalled();
      });

      it("learns a rotated key from the project's list the first time a token names it", async () => {
        await expect(jwksGuard.track(reqFor('key-1'))).resolves.toBe(
          'user:member-a',
        );
        const KEY_2 = { kid: 'key-2', kty: 'EC', alg: 'ES256' };
        fetchSpy.mockResolvedValue(jwksResponse({ keys: [KEY_1, KEY_2] }));
        now += JWKS_REFRESH_INTERVAL_MS;

        await expect(jwksGuard.track(reqFor('key-2'))).resolves.toBe(
          'user:member-a',
        );
        expect(getClaims).toHaveBeenLastCalledWith(withKid('key-2'), {
          jwks: { keys: [KEY_2] },
        });
        // Known from then on: no read for the next member.
        await expect(jwksGuard.track(reqFor('key-2'))).resolves.toBe(
          'user:member-a',
        );
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('lets a made-up kid start a read that teaches the real one, rather than taking its place', async () => {
        const KEY_2 = { kid: 'key-2', kty: 'EC', alg: 'ES256' };
        fetchSpy.mockResolvedValue(jwksResponse({ keys: [KEY_1, KEY_2] }));
        now += JWKS_REFRESH_INTERVAL_MS;

        await expect(jwksGuard.track(reqFor('made-up'))).resolves.toBe(
          'ip:203.0.113.40',
        );
        // Inside the next interval, the member's new key is already held.
        await expect(jwksGuard.track(reqFor('key-2'))).resolves.toBe(
          'user:member-a',
        );
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('makes requests arriving during a read wait for that one read', async () => {
        let answer!: (res: Response) => void;
        fetchSpy.mockReturnValue(
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
        );
        now += JWKS_REFRESH_INTERVAL_MS;
        const KEY_2 = { kid: 'key-2', kty: 'EC', alg: 'ES256' };
        const members = [1, 2, 3].map((n) =>
          jwksGuard.track(reqFor('key-2', `203.0.113.${50 + n}`)),
        );
        answer(jwksResponse({ keys: [KEY_1, KEY_2] }));
        await expect(Promise.all(members)).resolves.toEqual([
          'user:member-a',
          'user:member-a',
          'user:member-a',
        ]);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('makes a request wait for the boot read rather than race it', async () => {
        let answer!: (res: Response) => void;
        fetchSpy.mockReturnValue(
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
        );
        jwksGuard = await buildGuard();
        const member = jwksGuard.track(reqFor('key-1'));
        answer(jwksResponse({ keys: [KEY_1] }));
        await expect(member).resolves.toBe('user:member-a');
      });

      it.each([
        [
          'the JWKS is unreachable',
          () => Promise.reject(new TypeError('fetch failed')),
          'TypeError',
        ],
        [
          'the JWKS answers an error',
          () => Promise.resolve(jwksResponse({}, false, 503)),
          'HTTP 503',
        ],
        [
          'the body has no key list',
          () => Promise.resolve(jwksResponse({ keys: 'nope' })),
          'no key list',
        ],
      ])(
        'warns, and keys tokens it cannot check by address, when %s',
        async (_why, failure, named) => {
          fetchSpy.mockImplementation(failure);
          jwksGuard = await buildGuard();
          await expect(jwksGuard.track(reqFor('key-1'))).resolves.toBe(
            'ip:203.0.113.40',
          );
          expect(getClaims).not.toHaveBeenCalled();
          expect(warn).toHaveBeenCalledWith(expect.stringContaining(named));
          // Never the key, never the project's address.
          const logged = JSON.stringify(warn.mock.calls);
          expect(logged).not.toContain(SERVICE_KEY);
          expect(logged).not.toContain('project.example.test');

          // A later read that works is picked up by the next token.
          fetchSpy.mockResolvedValue(jwksResponse({ keys: [KEY_1] }));
          now += JWKS_REFRESH_INTERVAL_MS;
          await expect(jwksGuard.track(reqFor('key-1'))).resolves.toBe(
            'user:member-a',
          );
        },
      );

      it('keeps the keys it holds when a later read fails', async () => {
        await expect(jwksGuard.track(reqFor('key-1'))).resolves.toBe(
          'user:member-a',
        );
        fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
        now += JWKS_REFRESH_INTERVAL_MS;
        await jwksGuard.track(reqFor('made-up'));
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalled();
        await expect(jwksGuard.track(reqFor('key-1'))).resolves.toBe(
          'user:member-a',
        );
      });

      it('treats a token with no kid as one it cannot check', async () => {
        const noKid = `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url({ sub: 'u', exp: futureExp() })}.opaque`;
        await expect(
          jwksGuard.track({
            headers: { authorization: `Bearer ${noKid}` },
            ip: '203.0.113.35',
          }),
        ).resolves.toBe('ip:203.0.113.35');
        expect(getClaims).not.toHaveBeenCalled();
      });

      it('does not read the JWKS when no Supabase client is wired', async () => {
        fetchSpy.mockClear();
        await guard.onModuleInit();
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });

    it('falls back to IP for an ES256 token when no Supabase client is wired', async () => {
      // `guard` from the outer beforeEach has no SUPABASE_CLIENT provider.
      await expect(
        guard.track({
          headers: {
            authorization: `Bearer ${asymmetricJwt({ sub: 'u', exp: futureExp() })}`,
          },
          ip: '203.0.113.28',
        }),
      ).resolves.toBe('ip:203.0.113.28');
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

  // A bearer token that does not verify sends the auth guard to Supabase Auth,
  // so those requests share one counter per address across every route,
  // while signed-in members (keyed per user) and token-less calls (refused
  // by the auth guard without an outbound call) never touch it.
  describe('unverified-token bucket', () => {
    class FirstController {
      list(): void {}
    }
    class SecondController {
      list(): void {}
    }

    let bucketGuard: TestableGuard;
    let increment: jest.Mock;
    let header: jest.Mock;

    const ctxFor = (
      cls: new (...args: never[]) => unknown,
      handler: (...args: never[]) => unknown,
      req: Record<string, unknown>,
    ): ExecutionContext =>
      ({
        getClass: () => cls,
        getHandler: () => handler,
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({ header }),
        }),
      }) as unknown as ExecutionContext;

    const get = (authorization?: string): Record<string, unknown> => ({
      method: 'GET',
      headers: authorization ? { authorization } : {},
      ip: '198.51.100.20',
    });

    /** `[throttlerName, key]` for each counter the request reached. */
    const counted = (): [string, string][] =>
      (increment.mock.calls as unknown[][]).map((call) => [
        call[4] as string,
        call[0] as string,
      ]);

    /** Storage that reports the unverified-token bucket used up. */
    const usedUp = () =>
      increment.mockImplementation(
        (
          _key: string,
          _ttl: number,
          _limit: number,
          _b: number,
          name: string,
        ) =>
          Promise.resolve({
            totalHits: name === UNVERIFIED_BEARER_THROTTLER ? 201 : 1,
            timeToExpire: 60,
            isBlocked: name === UNVERIFIED_BEARER_THROTTLER,
            timeToBlockExpire: 30,
          }),
      );

    const refusal = (authorization: string): Promise<unknown> =>
      bucketGuard
        .canActivate(
          ctxFor(
            FirstController,
            FirstController.prototype.list,
            get(authorization),
          ),
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );

    beforeEach(async () => {
      header = jest.fn();
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
              {
                name: UNVERIFIED_BEARER_THROTTLER,
                ttl: UNVERIFIED_BEARER_TTL_MS,
                limit: UNVERIFIED_BEARER_LIMIT,
              },
            ],
          },
          { provide: getStorageToken(), useValue: { increment } },
        ],
      }).compile();
      bucketGuard = moduleRef.get(TestableGuard);
      await bucketGuard.onModuleInit();
    });

    it('counts a token that did not verify in one counter shared by every route', async () => {
      const forged = `Bearer ${makeJwt({ sub: 'x', exp: futureExp() }, null)}`;
      await bucketGuard.canActivate(
        ctxFor(FirstController, FirstController.prototype.list, get(forged)),
      );
      await bucketGuard.canActivate(
        ctxFor(SecondController, SecondController.prototype.list, get(forged)),
      );

      const unverified = counted().filter(
        ([name]) => name === UNVERIFIED_BEARER_THROTTLER,
      );
      expect(unverified).toHaveLength(2);
      expect(unverified[0][1]).toBe(unverified[1][1]);
      expect(increment).toHaveBeenCalledWith(
        expect.any(String),
        UNVERIFIED_BEARER_TTL_MS,
        UNVERIFIED_BEARER_LIMIT,
        UNVERIFIED_BEARER_TTL_MS,
        UNVERIFIED_BEARER_THROTTLER,
      );
      // The per-route `read` counters stay per route.
      const reads = counted().filter(([name]) => name === 'read');
      expect(reads[0][1]).not.toBe(reads[1][1]);
    });

    it('applies to writes too', async () => {
      const req = {
        ...get('Bearer not-a-jwt'),
        method: 'POST',
      };
      await bucketGuard.canActivate(
        ctxFor(FirstController, FirstController.prototype.list, req),
      );
      expect(
        counted()
          .map(([name]) => name)
          .sort(),
      ).toEqual([UNVERIFIED_BEARER_THROTTLER, 'write']);
    });

    it("leaves a signed-in member's request out of it", async () => {
      await bucketGuard.canActivate(
        ctxFor(
          FirstController,
          FirstController.prototype.list,
          get(`Bearer ${makeJwt({ sub: 'member-1', exp: futureExp() })}`),
        ),
      );
      expect(counted().map(([name]) => name)).toEqual(['read']);
    });

    it('leaves a call with no token out of it (health, version check, invite preview)', async () => {
      await bucketGuard.canActivate(
        ctxFor(FirstController, FirstController.prototype.list, get()),
      );
      await bucketGuard.canActivate(
        ctxFor(
          FirstController,
          FirstController.prototype.list,
          get('Basic abc123'),
        ),
      );
      expect(counted().map(([name]) => name)).toEqual(['read', 'read']);
    });

    // An outage of the guard's own means of checking (here: no verifier for
    // an ES256 token at all) must not put every member on a network into one
    // bucket: those tokens keep the per-route address keying alone.
    it('leaves out a token it could not check because its means of checking are down', async () => {
      const es256 = `${b64url({ alg: 'ES256', typ: 'JWT', kid: 'key-1' })}.${b64url({ sub: 'u', exp: futureExp() })}.sig`;
      await bucketGuard.canActivate(
        ctxFor(
          FirstController,
          FirstController.prototype.list,
          get(`Bearer ${es256}`),
        ),
      );
      expect(counted().map(([name]) => name)).toEqual(['read']);
    });

    // A client recovers a dead or stale session only through a 401: mobile
    // drops its learned clock offset and re-checks the session, web signs a
    // revoked one out. Past the limit, a 429 would keep such a member stuck
    // for as long as their network stays over it.
    describe('once the address has used it up', () => {
      beforeEach(() => {
        usedUp();
      });

      it.each([
        ['a malformed token', 'Bearer not-a-jwt'],
        [
          'a forged signature',
          `Bearer ${makeJwt({ sub: 'x', exp: futureExp() }, null)}`,
        ],
        [
          'a lapsed token from a phone whose clock runs behind',
          `Bearer ${makeJwt({ sub: 'member-1', exp: Math.floor(Date.now() / 1000) - 30 })}`,
        ],
      ])(
        "answers %s with the auth guard's 401, not a 429",
        async (_why, authorization) => {
          const error = await refusal(authorization);
          expect(error).toBeInstanceOf(AuthRejectedException);
          expect((error as AuthRejectedException).getStatus()).toBe(401);
          expect((error as AuthRejectedException).getResponse()).toMatchObject({
            message: INVALID_TOKEN_MESSAGE,
          });
          expect((error as AuthRejectedException).detail).toMatchObject({
            reason: 'claims_rejected',
            authErrorCode: UNVERIFIED_LIMIT_AUTH_CODE,
          });
          // No retry header on a 401: the client should refresh, not wait.
          expect(header).not.toHaveBeenCalledWith(
            'Retry-After',
            expect.anything(),
          );
        },
      );

      it('says on the 401 whether the token had expired', async () => {
        const lapsed = await refusal(
          `Bearer ${makeJwt({ sub: 'member-1', exp: Math.floor(Date.now() / 1000) - 30 })}`,
        );
        expect((lapsed as AuthRejectedException).detail.tokenExpired).toBe(
          true,
        );
      });

      // A token the guard could not check might be a member's valid one (a
      // signing key it has not learned yet), so it is never told its session
      // is gone: it waits like any other throttled request.
      it('answers a token it could not check with the usual 429', async () => {
        delete process.env.SUPABASE_JWT_SECRET;
        const error = await refusal(
          `Bearer ${makeJwt({ sub: 'member-1', exp: futureExp() })}`,
        );
        expect(error).toBeInstanceOf(ThrottlerException);
        expect((error as ThrottlerException).getStatus()).toBe(429);
        expect(header).toHaveBeenCalledWith('Retry-After', '30');
      });

      it('still lets a signed-in member through', async () => {
        await expect(
          refusal(`Bearer ${makeJwt({ sub: 'member-1', exp: futureExp() })}`),
        ).resolves.toBeUndefined();
      });
    });

    // The per-route buckets count the same address, so the same holds when
    // one of those is what ran out.
    it("answers an invalid token with a 401 when a route's own bucket ran out too", async () => {
      increment.mockImplementation(
        (
          _key: string,
          _ttl: number,
          _limit: number,
          _b: number,
          name: string,
        ) =>
          Promise.resolve({
            totalHits: name === 'read' ? 101 : 1,
            timeToExpire: 60,
            isBlocked: name === 'read',
            timeToBlockExpire: 30,
          }),
      );
      const lapsed = await refusal(
        `Bearer ${makeJwt({ sub: 'member-1', exp: Math.floor(Date.now() / 1000) - 30 })}`,
      );
      expect(lapsed).toBeInstanceOf(AuthRejectedException);

      const tokenless = await bucketGuard
        .canActivate(
          ctxFor(FirstController, FirstController.prototype.list, get()),
        )
        .catch((error: unknown) => error);
      expect(tokenless).toBeInstanceOf(ThrottlerException);
    });

    it('is skipped on the Stripe webhook, whatever it carries', async () => {
      const req = { ...get('Bearer not-a-jwt'), method: 'POST' };
      await bucketGuard.canActivate(
        ctxFor(
          WebhookController,
          WebhookController.prototype.handleStripeWebhook,
          req,
        ),
      );
      expect(increment).not.toHaveBeenCalled();
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
      route('POST /invites/preview', InviteController, IN.preview, 10),
      route('POST /events', EventController, EV.create, 10),
      route('PATCH /events/:id', EventController, EV.update, 10),
      route('POST /ai/ask', AskController, AskController.prototype.ask, 10),
      route(
        'POST /ai/ask/dictation',
        AskController,
        AskController.prototype.cleanDictation,
        10,
      ),
      route('POST /ai/act', ActController, ActController.prototype.act, 10),
      route(
        'POST /ai/act/event-audience',
        ActController,
        ActController.prototype.eventAudience,
        10,
      ),
      route(
        'POST /ai/catch-up',
        ChatCatchUpController,
        ChatCatchUpController.prototype.catchUp,
        10,
      ),
      route(
        'POST /documents/upload-url',
        ChapterDocumentController,
        CD.requestUploadUrl,
        10,
      ),
      route(
        'POST /documents/upload-urls',
        ChapterDocumentController,
        CD.requestUploadUrls,
        10,
      ),
      route(
        'POST /documents/batch',
        ChapterDocumentController,
        CD.confirmUploads,
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
        'POST /tasks/photo-upload-url',
        TaskController,
        TaskController.prototype.requestPhotoUploadUrl,
        10,
      ),
      route(
        'POST /users/me/avatar-url',
        UserController,
        US.requestAvatarUploadUrl,
        10,
      ),
      route('GET /search', SearchController, SR.search, 20),
      route(
        'POST /integrations/dev-log',
        DevLogController,
        DevLogController.prototype.post,
        10,
      ),
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

  // The one notion of a caller's address: the throttler, the calendar feed's
  // miss limit and the auth-failure spike detector all count by it.
  describe('clientAddress', () => {
    it('takes the first forwarded address, cutting IPv6 to its /64', () => {
      expect(
        clientAddress({ ips: ['2001:db8:1:2:3:4:5:6', '10.0.0.1'], ip: 'x' }),
      ).toBe('2001:db8:1:2::/64');
      expect(clientAddress({ ips: [], ip: '198.51.100.3' })).toBe(
        '198.51.100.3',
      );
    });

    it('is undefined when Express resolved no address', () => {
      expect(clientAddress({ ips: [] })).toBeUndefined();
      expect(clientAddress({ ip: '' })).toBeUndefined();
    });
  });

  describe('throwThrottlingException', () => {
    it('sets a standard Retry-After header before throwing', async () => {
      const header = jest.fn();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
          getResponse: () => ({ header }),
        }),
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

    it('says what happened and what to do, not the framework class name (#3142)', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
          getResponse: () => ({ header: jest.fn() }),
        }),
        getClass: () => class {},
        getHandler: () => () => undefined,
      } as unknown as ExecutionContext;
      const detail = {
        timeToBlockExpire: 42,
      } as unknown as ThrottlerLimitDetail;

      const thrown = await guard
        .throwThrottling(context, detail)
        .catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(ThrottlerException);
      expect((thrown as ThrottlerException).getStatus()).toBe(429);
      // The body's `message` is what clients show; the filter reads it from here.
      expect((thrown as ThrottlerException).getResponse()).toBe(
        THROTTLED_MESSAGE,
      );
      expect(THROTTLED_MESSAGE).not.toMatch(/Throttler|Exception/);
    });
  });
});
