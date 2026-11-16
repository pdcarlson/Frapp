import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createClient } from '@supabase/supabase-js';
import { webcrypto } from 'node:crypto';
import { SupabaseAuthGuard, failedClaimCheck } from './supabase-auth.guard';
import { ChapterGuard } from './chapter.guard';
import { AuthRejectedException } from './auth-rejected.exception';
import { VERIFY_SESSION_LOCALLY_KEY } from '../decorators/session-check.decorator';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import type { RequestContext } from '../types/request-context.types';
import { runWithRequestReads } from '../../infrastructure/supabase/request-reads';

/**
 * The local session check (#5043, Paul 2026-11-16), against the real
 * `getClaims` and real ES256 signatures. Only the network is stubbed: the
 * project's JWKS endpoint and Auth's `/user`, so each case also proves whether
 * the guard asked Auth. Paul's condition 6: on a read, an expired token, a bad
 * signature, the wrong `aud` or `iss`, and another project's token are all
 * refused; and every write calls `getUser`.
 */

const PROJECT_URL = 'https://project-a.supabase.co';
const ISSUER = `${PROJECT_URL}/auth/v1`;
const SUB = '6f0d3c1e-2b7a-4c55-9d8e-0a1b2c3d4e5f';
const KID = 'kid-project-a';

type KeyPair = { privateKey: CryptoKey; publicJwk: JsonWebKey };

async function es256Pair(): Promise<KeyPair> {
  const pair = (await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk };
}

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

async function signEs256(
  key: CryptoKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    sub: SUB,
    exp: nowSeconds() + 3600,
    iat: nowSeconds(),
    email: 'member@example.test',
    app_metadata: { provider: 'email' },
    active_chapter_id: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

/** A route both guards protect, as every opted-in route is. */
class ChapterRoute {}
Reflect.defineMetadata(
  GUARDS_METADATA,
  [SupabaseAuthGuard, ChapterGuard],
  ChapterRoute,
);
/** A route only this guard protects (no `ChapterGuard`). */
class AuthOnlyRoute {}
Reflect.defineMetadata(GUARDS_METADATA, [SupabaseAuthGuard], AuthOnlyRoute);

function markedHandler() {
  const handler = () => undefined;
  Reflect.defineMetadata(VERIFY_SESSION_LOCALLY_KEY, true, handler);
  return handler;
}

let clientCount = 0;

describe('SupabaseAuthGuard: reads verified locally (#5043)', () => {
  let projectKey: KeyPair;
  let otherKey: KeyPair;
  let jwksAnswer: () => Promise<Response>;
  let userAnswer: () => Promise<Response>;
  let calls: string[];
  let guard: SupabaseAuthGuard;

  beforeAll(async () => {
    projectKey = await es256Pair();
    otherKey = await es256Pair();
  });

  beforeEach(() => {
    calls = [];
    jwksAnswer = () =>
      Promise.resolve(
        Response.json({
          keys: [
            { ...projectKey.publicJwk, kid: KID, alg: 'ES256', use: 'sig' },
          ],
        }),
      );
    // Auth refuses by default; a case that expects acceptance says so.
    userAnswer = () =>
      Promise.resolve(
        Response.json(
          { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' },
          { status: 403 },
        ),
      );
    const fetchStub = (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/auth/v1/.well-known/jwks.json')) {
        calls.push('jwks');
        return jwksAnswer();
      }
      if (url.endsWith('/auth/v1/user')) {
        calls.push('getUser');
        return userAnswer();
      }
      if (url.endsWith('/rest/v1/rpc/get_request_context')) {
        calls.push('get_request_context');
        return Promise.resolve(
          Response.json({
            user: { id: 'app-user-1' },
            chapter: null,
            member: null,
            roles: [],
          }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    // auth-js caches the JWKS process-wide per storage key; a fresh key per
    // case makes each one fetch it, as a cold process would.
    const client = createClient(PROJECT_URL, 'anon-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: `local-session-spec-${++clientCount}`,
      },
      global: { fetch: fetchStub },
    }) as unknown as FrappSupabaseClient;
    const config = {
      get: (key: string) => (key === 'SUPABASE_URL' ? PROJECT_URL : undefined),
    } as unknown as ConfigService;
    guard = new SupabaseAuthGuard(client, new Reflector(), config);
  });

  const projectToken = (overrides: Record<string, unknown> = {}) =>
    signEs256(
      projectKey.privateKey,
      { alg: 'ES256', kid: KID, typ: 'JWT' },
      claims(overrides),
    );

  function context(
    token: string,
    {
      method = 'GET',
      handler = markedHandler(),
      route = ChapterRoute,
      throttled = true,
    }: {
      method?: string;
      handler?: () => unknown;
      route?: new () => unknown;
      throttled?: boolean;
    } = {},
  ): { ctx: ExecutionContext; request: Partial<RequestContext> } {
    const request: Partial<RequestContext> = {
      method,
      headers: { authorization: `Bearer ${token}` },
      // The throttler (the global guard) verified this token first.
      throttlerVerifiedClaims: throttled
        ? {
            sub: SUB,
            active_chapter_id: '11111111-1111-4111-8111-111111111111',
          }
        : undefined,
    } as Partial<RequestContext>;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => route,
    } as unknown as ExecutionContext;
    return { ctx, request };
  }

  async function refusal(ctx: ExecutionContext): Promise<unknown> {
    return guard.canActivate(ctx).then(
      () => {
        throw new Error('expected the guard to refuse');
      },
      (error: unknown) => error,
    );
  }

  it('accepts a valid token without asking Auth, and records the verified sub', async () => {
    const { ctx, request } = context(await projectToken());

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(calls).toEqual(['jwks']);
    expect(request.locallyVerifiedAuthId).toBe(SUB);
    expect(request.supabaseUser).toBeUndefined();
    expect(request.jwtClaims?.active_chapter_id).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('verifies HEAD the same way', async () => {
    const { ctx } = context(await projectToken(), { method: 'HEAD' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(calls).not.toContain('getUser');
  });

  describe('refuses on a read, without asking Auth', () => {
    const expectRefused = async (
      token: string,
      check: string,
    ): Promise<void> => {
      const error = await refusal(context(token).ctx);
      expect(error).toBeInstanceOf(AuthRejectedException);
      expect((error as AuthRejectedException).getStatus()).toBe(401);
      expect((error as AuthRejectedException).detail).toMatchObject({
        reason: 'claims_rejected',
        authErrorCode: check,
      });
      expect(calls).not.toContain('getUser');
    };

    it('an expired token', async () => {
      await expectRefused(
        await projectToken({ exp: nowSeconds() - 5 }),
        'invalid_jwt',
      );
    });

    it('a bad signature: right header and claims, another key signed it', async () => {
      const forged = await signEs256(
        otherKey.privateKey,
        { alg: 'ES256', kid: KID, typ: 'JWT' },
        claims(),
      );
      await expectRefused(forged, 'invalid_jwt');
    });

    it('a tampered payload under a valid signature', async () => {
      const [header, , signature] = (await projectToken()).split('.');
      const tampered = `${header}.${b64(claims({ sub: '00000000-0000-4000-8000-000000000000' }))}.${signature}`;
      await expectRefused(tampered, 'invalid_jwt');
    });

    it('the wrong aud', async () => {
      await expectRefused(await projectToken({ aud: 'anon' }), 'aud_mismatch');
    });

    it('the wrong iss', async () => {
      await expectRefused(
        await projectToken({ iss: 'https://project-b.supabase.co/auth/v1' }),
        'iss_mismatch',
      );
    });

    it('a role other than authenticated', async () => {
      await expectRefused(
        await projectToken({ role: 'service_role' }),
        'role_mismatch',
      );
    });

    it('a sub other than the one the throttler verified', async () => {
      await expectRefused(
        await projectToken({ sub: '00000000-0000-4000-8000-000000000000' }),
        'sub_mismatch',
      );
    });
  });

  describe("refuses another project's token", () => {
    // Another project's real token: its own key and `kid`, its own issuer.
    const foreignToken = () =>
      signEs256(
        otherKey.privateKey,
        { alg: 'ES256', kid: 'kid-project-b', typ: 'JWT' },
        claims({ iss: 'https://project-b.supabase.co/auth/v1' }),
      );

    it("when its key is not in this project's JWKS (getClaims then asks this project's Auth, which refuses)", async () => {
      const error = await refusal(context(await foreignToken()).ctx);
      expect(error).toBeInstanceOf(AuthRejectedException);
      expect((error as AuthRejectedException).detail.reason).toBe(
        'claims_rejected',
      );
      expect(calls).toEqual(['jwks', 'getUser']);
    });

    it('by its issuer, even if Auth were to accept it', async () => {
      // The guard's own `iss` check, not Auth, is what refuses here.
      userAnswer = () =>
        Promise.resolve(
          Response.json({
            id: SUB,
            aud: 'authenticated',
            role: 'authenticated',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z',
          }),
        );
      const error = await refusal(context(await foreignToken()).ctx);
      expect(error).toBeInstanceOf(AuthRejectedException);
      expect((error as AuthRejectedException).detail).toMatchObject({
        reason: 'claims_rejected',
        authErrorCode: 'iss_mismatch',
      });
    });
  });

  it('starts the one get_request_context call alongside the verification (#3583)', async () => {
    const { ctx } = context(await projectToken());

    await runWithRequestReads('GET', async () => {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
    });

    expect(calls).toContain('get_request_context');
    expect(calls).not.toContain('getUser');
  });

  it('fails closed with a 503 when the JWKS cannot be fetched, and never asks Auth instead', async () => {
    jwksAnswer = () =>
      Promise.resolve(new Response('unavailable', { status: 503 }));
    const error = await refusal(context(await projectToken()).ctx);
    expect((error as { getStatus(): number }).getStatus()).toBe(503);
    expect(calls).toEqual(['jwks']);
  });

  it('fails closed with a 503 when the JWKS fetch throws', async () => {
    jwksAnswer = () => Promise.reject(new TypeError('fetch failed'));
    const error = await refusal(context(await projectToken()).ctx);
    expect((error as { getStatus(): number }).getStatus()).toBe(503);
    expect(calls).not.toContain('getUser');
  });

  describe('asks Auth (getUser) instead', () => {
    const acceptingAuth = () => {
      userAnswer = () =>
        Promise.resolve(
          Response.json({
            id: SUB,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'member@example.test',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z',
          }),
        );
    };

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'for every write (%s), even on a marked handler',
      async (method) => {
        acceptingAuth();
        const { ctx, request } = context(await projectToken(), { method });

        await expect(guard.canActivate(ctx)).resolves.toBe(true);

        expect(calls).toContain('getUser');
        expect(request.supabaseUser?.id).toBe(SUB);
        expect(request.locallyVerifiedAuthId).toBeUndefined();
      },
    );

    it('and a write whose session Auth revoked is refused', async () => {
      const { ctx } = context(await projectToken(), { method: 'POST' });
      const error = await refusal(ctx);
      expect(error).toBeInstanceOf(AuthRejectedException);
      expect((error as AuthRejectedException).detail.reason).toBe(
        'token_rejected',
      );
      expect(calls).toContain('getUser');
    });

    it('for a read whose handler is not marked', async () => {
      acceptingAuth();
      const { ctx } = context(await projectToken(), {
        handler: () => undefined,
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(calls).toContain('getUser');
    });

    it('for a marked read on a route without ChapterGuard', async () => {
      acceptingAuth();
      const { ctx } = context(await projectToken(), { route: AuthOnlyRoute });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(calls).toContain('getUser');
    });

    it('for a marked read the throttler did not verify', async () => {
      acceptingAuth();
      const { ctx } = context(await projectToken(), { throttled: false });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(calls).toContain('getUser');
    });

    it('for a valid HS256 token, which Auth accepts and the guard does not refuse on its alg', async () => {
      acceptingAuth();
      const hs256 = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims())}.c2ln`;
      const { ctx, request } = context(hs256);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      // Only Auth: the session check, then `readClaims`, whose `getClaims`
      // also asks Auth for a symmetric token. Never the JWKS.
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((call) => call === 'getUser')).toBe(true);
      expect(request.supabaseUser?.id).toBe(SUB);
      expect(request.locallyVerifiedAuthId).toBeUndefined();
    });

    it('for an HS256 token, and Auth refuses a forged one', async () => {
      const hs256 = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims())}.c2ln`;
      const error = await refusal(context(hs256).ctx);
      expect(error).toBeInstanceOf(AuthRejectedException);
      expect(calls).toEqual(['getUser']);
    });

    it('for an alg:none token, and Auth refuses it', async () => {
      const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims())}.`;
      const error = await refusal(context(unsigned).ctx);
      expect(error).toBeInstanceOf(AuthRejectedException);
      expect(calls).toEqual(['getUser']);
    });

    it('everywhere, when the guard has no project URL to check iss against', async () => {
      acceptingAuth();
      const client = createClient(PROJECT_URL, 'anon-key', {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          storageKey: `local-session-spec-${++clientCount}`,
        },
        global: {
          fetch: (input: RequestInfo | URL) => {
            calls.push(String(input).endsWith('/user') ? 'getUser' : 'other');
            return userAnswer();
          },
        },
      }) as unknown as FrappSupabaseClient;
      const unconfigured = new SupabaseAuthGuard(client, new Reflector());
      await expect(
        unconfigured.canActivate(context(await projectToken()).ctx),
      ).resolves.toBe(true);
      expect(calls).toContain('getUser');
    });
  });
});

describe('failedClaimCheck (#5043)', () => {
  const now = 1_800_000_000;
  const base = {
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    sub: SUB,
    exp: now + 60,
  };
  const es256 = { alg: 'ES256' };

  it.each([
    ['passes a well-formed token', es256, base, null],
    [
      'accepts aud as an array',
      es256,
      { ...base, aud: ['authenticated'] },
      null,
    ],
    ['accepts RS256', { alg: 'RS256' }, base, null],
    ['refuses HS256', { alg: 'HS256' }, base, 'alg_not_allowed'],
    ['refuses alg none', { alg: 'none' }, base, 'alg_not_allowed'],
    ['refuses a missing alg', {}, base, 'alg_not_allowed'],
    [
      'refuses another issuer',
      es256,
      { ...base, iss: 'https://x/auth/v1' },
      'iss_mismatch',
    ],
    [
      'refuses a missing issuer',
      es256,
      { ...base, iss: undefined },
      'iss_mismatch',
    ],
    [
      'refuses the anon audience',
      es256,
      { ...base, aud: 'anon' },
      'aud_mismatch',
    ],
    [
      'refuses a missing audience',
      es256,
      { ...base, aud: undefined },
      'aud_mismatch',
    ],
    [
      'refuses the anon role',
      es256,
      { ...base, role: 'anon' },
      'role_mismatch',
    ],
    [
      'refuses service_role',
      es256,
      { ...base, role: 'service_role' },
      'role_mismatch',
    ],
    ['refuses a non-uuid sub', es256, { ...base, sub: 'abc' }, 'bad_sub'],
    ['refuses a missing sub', es256, { ...base, sub: undefined }, 'bad_sub'],
    ['refuses exp now', es256, { ...base, exp: now }, 'expired'],
    ['refuses a missing exp', es256, { ...base, exp: undefined }, 'expired'],
  ])('%s', (_label, header, payload, expected) => {
    expect(
      failedClaimCheck(header, payload as Record<string, unknown>, ISSUER, now),
    ).toBe(expected);
  });
});
