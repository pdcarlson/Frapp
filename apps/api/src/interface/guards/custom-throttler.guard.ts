import {
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
  normalizeIp,
} from '@nestjs/throttler';
import { createHash, createHmac } from 'node:crypto';
import type { Response } from 'express';
import type { JWK, JwtPayload } from '@supabase/supabase-js';
import { getHeaderValue } from '../types/request-context.types';
import { constantTimeEquals } from '#domain/utils/constant-time';
import {
  decodeJwtSegment,
  readUnverifiedJwtPayload,
} from '#domain/utils/jwt-segment';
import {
  INVALID_TOKEN_MESSAGE,
  authRejected,
  tokenExpired,
} from './auth-rejected.exception';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

/**
 * Signature algorithms verified against the project's JWKS. Supabase signs
 * with ES256 by default on every project created since asymmetric signing
 * keys shipped, and both hosted Frapp projects are on it (`HS256` is
 * `previously_used` on each). RS256 is the other key type the dashboard can
 * issue. Anything else — `none`, a HMAC alg with a JWKS-shaped header — is
 * refused before any verifier sees it.
 */
export const JWKS_VERIFIED_ALGS: ReadonlySet<string> = new Set([
  'ES256',
  'RS256',
]);

/**
 * How often a token naming a signing-key id (`kid`) the guard does not hold
 * may make it read the project's JWKS again (see `jwksVerdict`). The read
 * learns every key the project lists, so after a key rotation the first
 * request carrying the new `kid` teaches it for everyone; the interval bounds
 * outbound reads to six a minute for the whole process however many unknown
 * `kid`s arrive.
 */
export const JWKS_REFRESH_INTERVAL_MS = 10_000;

/**
 * How long one read of the project's JWKS may take. Requests whose `kid` is
 * not yet known wait for a read in flight, so it is short.
 */
export const JWKS_READ_TIMEOUT_MS = 3_000;

/**
 * The name of the throttler that counts requests carrying a bearer token this
 * guard could not tie to a verified user (`AppModule` registers it with
 * {@link UNVERIFIED_BEARER_LIMIT}). Unlike `read` and `write`, its counter is
 * one per address, shared by every handler: see `generateKey`.
 */
export const UNVERIFIED_BEARER_THROTTLER = 'unverified';

/**
 * Requests a minute one address may send with a bearer token that did not
 * verify, across all routes together. Each such request makes the auth guard
 * ask Supabase Auth about the token, so without a shared ceiling the
 * per-route buckets let one address multiply its calls by the number of
 * routes.
 *
 * What counts (`TokenVerdict`): a token the guard found invalid (malformed,
 * expired, a bad signature against a key the project lists), and one it could
 * not check although its key list is working (a `kid` the project's JWKS did
 * not list when last read). What does not: a token that verified (keyed per
 * user instead), no token at all (the auth guard refuses those without an
 * outbound call), and a token the guard could not check because its own
 * means of checking are down (the JWKS not read yet, or its last read
 * failed), so an outage on that side never puts a whole network's members in
 * this one bucket.
 *
 * Past the limit (or any other bucket's), an invalid token is answered with
 * the auth guard's own 401 rather than a 429 (`throwThrottlingException`): a
 * client recovers from a dead or stale session only through a 401 (it drops a
 * learned clock offset, refreshes or signs out), so a 429 there would keep it
 * stuck for as long as the address stays over. A token the guard could not
 * check gets the 429, so a valid one is never told its session is gone.
 * Product choice on the number: generous for a campus network of members
 * whose tokens lapse together, and a small fraction of what the per-route
 * buckets allowed one address in total.
 */
export const UNVERIFIED_BEARER_LIMIT = 200;

/** The window {@link UNVERIFIED_BEARER_LIMIT} counts over. */
export const UNVERIFIED_BEARER_TTL_MS = 60_000;

/**
 * The `authErrorCode` on the throttler's 401 (see
 * {@link UNVERIFIED_BEARER_LIMIT}), so the security record tells it apart
 * from the auth guard's own refusals (`spec/behavior/observability.md`).
 */
export const UNVERIFIED_LIMIT_AUTH_CODE = 'unverified_limit';

/**
 * IPv6 addresses are bucketed by their /64. A home or campus network is
 * handed at least a whole /64, and any device on it may pick a fresh address
 * inside it at will (privacy addresses), so keying on the full address would
 * give one caller a new bucket per request. A /64 is the unit providers
 * assign per subscriber, so it is still one network. IPv4 is unchanged.
 */
export const IPV6_BUCKET_PREFIX = 64;

/**
 * The `message` every 429 from the throttler carries (#3142).
 *
 * The base guard's default is "ThrottlerException: Too Many Requests", a
 * framework class name, and clients show a refusal's `message`: web's
 * `getErrorMessage` puts it in a toast. Every bucket resets within a minute
 * (`app.module.ts`), so "a minute" is the longest a member waits; the exact
 * seconds are in `Retry-After`. Copy: `writing.md` § Rate limited (global).
 */
export const THROTTLED_MESSAGE =
  'Too many requests in a short time. Wait a minute, then try again.';

/**
 * Methods counted against the `read` bucket; everything else is a `write`.
 * Exported so tests derive the expected bucket from the same set the guard
 * uses, rather than from a copy that could drift away from it.
 */
export const READ_THROTTLE_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  /**
   * Property-injected, and optional, on purpose. `ThrottlerGuard`'s own
   * constructor takes the throttler options, storage and `Reflector`, and a
   * subclass constructor would have to restate all three injections to add a
   * fourth; a property keeps the base wiring untouched. Optional because the
   * guard must still construct where no Supabase client is provided (the unit
   * tests, a stripped-down module) — it then degrades to the HS256 path and
   * per-IP keying exactly as before.
   */
  @Optional()
  @Inject(SUPABASE_CLIENT)
  private readonly supabase?: FrappSupabaseClient;

  private readonly keysLogger = new Logger(CustomThrottlerGuard.name);

  /**
   * Rate-limit buckets are keyed per authenticated user (Supabase JWT `sub`)
   * rather than per IP, so the limit follows a user across networks and is not
   * shared by everyone behind a single NAT/proxy — a chapter house on one
   * Wi-Fi is one public address, and 100 reads a minute shared across thirty
   * members opening the app is a 429 for all of them.
   *
   * The throttler runs as the global `APP_GUARD`, *before* the
   * controller-scoped `SupabaseAuthGuard`, so `request.supabaseUser` is not yet
   * populated here. We read the subject from the bearer token directly — but
   * only after verifying its signature. Verification is essential: without it
   * a caller could mint tokens with a rotating fake `sub` to land every request
   * in a fresh bucket and evade the limit entirely (and amplify the downstream
   * `supabase.auth.getUser` call). Two verifiers, chosen by the token's `alg`:
   *
   * - **HS256** — checked locally against `SUPABASE_JWT_SECRET`. Kept for a
   *   project that still signs symmetrically (an older CLI, a self-hosted
   *   GoTrue); no Frapp project does today.
   * - **ES256 / RS256** — checked with `supabase.auth.getClaims()` against the
   *   key the project's JWKS lists for the token's `kid`, which this guard
   *   reads itself (`jwksVerdict`), so a check is a local WebCrypto signature
   *   check, not a network round trip. Both hosted Frapp projects sign ES256
   *   (`HS256` is `previously_used` on each) and so does the local stack the
   *   pinned CLI starts, so before this path existed no request anywhere was
   *   keyed per user — the secret would not have verified those tokens even if
   *   it had been set, and `SupabaseAuthGuard` says as much about its own
   *   `getClaims()` call.
   *
   * Requests without a valid, unexpired token fall back to per-IP keying, which
   * preserves the original denial-of-service protection; most of those that
   * sent a token are also counted in the shared
   * {@link UNVERIFIED_BEARER_THROTTLER} bucket (`handleRequest`).
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return (await this.tracking(req)).tracker;
  }

  /**
   * One request's tracker, worked out once. The base guard asks for it once
   * per throttler that runs, and the token check behind it must run once: a
   * second check would be wasted work, and for an unknown `kid` could start a
   * second JWKS read.
   */
  private tracking(req: Record<string, any>): Promise<RequestTracking> {
    let tracking = trackingByRequest.get(req);
    if (!tracking) {
      tracking = this.resolveTracking(req);
      trackingByRequest.set(req, tracking);
    }
    return tracking;
  }

  private async resolveTracking(
    req: Record<string, any>,
  ): Promise<RequestTracking> {
    const verification = await this.verifyBearer(req);
    if (verification.verdict === 'verified') {
      const { claims, userId } = verification;
      // Handed on so `SupabaseAuthGuard` can start the chapter lookups on
      // this verified `sub` (#3728). On a read marked
      // `@VerifySessionLocally()` (#5043) that guard verifies the token again
      // itself, but only when these claims are present: so a token this
      // guard did not verify (a `kid` the project's JWKS does not list,
      // among others) never reaches a verifier from there either. Keep that
      // precondition.
      (
        req as { throttlerVerifiedClaims?: JwtPayload }
      ).throttlerVerifiedClaims = claims;
      return { tracker: `user:${userId}`, verdict: 'verified' };
    }
    return {
      tracker: `ip:${clientAddress(req) ?? 'unknown'}`,
      verdict: verification.verdict,
    };
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context, throttler } = requestProps;
    const request = context.switchToHttp().getRequest<{ method?: string }>();
    const method = request.method?.toUpperCase() ?? '';
    const isReadMethod = READ_THROTTLE_METHODS.has(method);

    if (throttler.name === 'write' && isReadMethod) {
      return true;
    }

    if (throttler.name === 'read' && !isReadMethod) {
      return true;
    }

    // Every method, but only a request whose bearer token the guard found
    // invalid or could not check (`UNVERIFIED_BEARER_LIMIT` says which): a
    // signed-in member's request, and one with no token at all, pass this
    // throttler untouched.
    if (throttler.name === UNVERIFIED_BEARER_THROTTLER) {
      const { verdict } = await this.tracking(request as Record<string, any>);
      if (!COUNTED_VERDICTS.has(verdict)) {
        return true;
      }
    }

    return super.handleRequest(requestProps);
  }

  /**
   * `read` and `write` keep the base key: one counter per handler per caller.
   * The unverified-token counter leaves the handler out, so it is one per
   * address across the whole API: spreading requests over many routes does
   * not buy more of them.
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    if (name === UNVERIFIED_BEARER_THROTTLER) {
      return createHash('sha256').update(`${name}-${suffix}`).digest('hex');
    }
    return super.generateKey(context, suffix, name);
  }

  /**
   * Starts the first read of the project's signing keys. Not awaited, so boot
   * never waits on the network; a request whose `kid` is not yet known waits
   * for it instead (`jwksVerdict`), at most {@link JWKS_READ_TIMEOUT_MS}.
   */
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    if (this.supabase) {
      void this.readSigningKeys();
    }
  }

  /** Every 429 from the throttler, any bucket, reads {@link THROTTLED_MESSAGE}. */
  protected getErrorMessage(): Promise<string> {
    return Promise.resolve(THROTTLED_MESSAGE);
  }

  /**
   * Emit a standard, unsuffixed `Retry-After` header (in seconds) on 429s.
   * Because we register *named* throttlers (`read`/`write`), the base guard
   * only sets a name-suffixed header (`Retry-After-read` / `Retry-After-write`)
   * that HTTP clients do not honour, so we add the canonical one here.
   *
   * The one refusal that is not a 429: a request whose token the guard found
   * invalid gets the auth guard's own 401 instead, whichever bucket it used
   * up. That is the answer the auth guard would give it, and a client
   * recovers a dead or stale session only through a 401 (see
   * {@link UNVERIFIED_BEARER_LIMIT}).
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const http = context.switchToHttp();
    const request = http.getRequest<Record<string, any>>();
    if ((await this.tracking(request)).verdict === 'rejected') {
      throw authRejected(INVALID_TOKEN_MESSAGE, 'claims_rejected', {
        authErrorCode: UNVERIFIED_LIMIT_AUTH_CODE,
        tokenExpired: tokenExpired(bearerToken(request) ?? ''),
      });
    }
    const res = http.getResponse<Response>();
    res.header('Retry-After', String(throttlerLimitDetail.timeToBlockExpire));
    await super.throwThrottlingException(context, throttlerLimitDetail);
  }

  /**
   * What the bearer token on the request is (`TokenVerdict`), with the claims
   * and subject when it verified. The caller keys a verified one per user and
   * everything else per address.
   */
  private async verifyBearer(req: Record<string, any>): Promise<Verification> {
    const token = bearerToken(req);
    if (token === null) {
      return NO_TOKEN;
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      return REJECTED;
    }
    const [headerSeg, payloadSeg, signatureSeg] = segments;

    // A header that isn't a JSON object (unparseable, `null`, a number)
    // carries no `alg`, and a payload that isn't one carries no claims:
    // Supabase Auth refuses either.
    const decodedHeader = decodeJwtSegment(headerSeg);
    if (decodedHeader === null || typeof decodedHeader !== 'object') {
      return REJECTED;
    }
    if (readUnverifiedJwtPayload(token) === undefined) {
      return REJECTED;
    }
    // Supabase Auth refuses an expired token whatever signed it, so one whose
    // own `exp` has passed is invalid without a signature check.
    if (tokenExpired(token) === true) {
      return REJECTED;
    }
    const header = decodedHeader as { alg?: unknown; kid?: unknown };

    if (header.alg === 'HS256') {
      return this.hs256Verdict(headerSeg, payloadSeg, signatureSeg);
    }
    if (typeof header.alg === 'string' && JWKS_VERIFIED_ALGS.has(header.alg)) {
      return this.jwksVerdict(
        token,
        typeof header.kid === 'string' ? header.kid : undefined,
      );
    }
    // `none`, or an alg Supabase never signs with: nothing accepts it.
    return REJECTED;
  }

  /**
   * HS256 verified against `SUPABASE_JWT_SECRET`. Without the secret there is
   * no way to check the signature, so the token is `unknown`, never verified.
   */
  private hs256Verdict(
    headerSeg: string,
    payloadSeg: string,
    signatureSeg: string,
  ): Verification {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      return UNKNOWN;
    }

    const expected = createHmac('sha256', secret)
      .update(`${headerSeg}.${payloadSeg}`)
      .digest('base64url');
    if (!constantTimeEquals(signatureSeg, expected)) {
      return REJECTED;
    }

    const payload = decodeJwtSegment(payloadSeg);
    return verifiedOrRejected(
      payload !== null && typeof payload === 'object'
        ? (payload as JwtPayload)
        : null,
    );
  }

  /**
   * ES256 / RS256, verified by supabase-js's `getClaims` against the one key
   * the project's JWKS lists under the token's `kid`, handed to it from
   * {@link signingKeys}: a local WebCrypto check, never a fetch, because
   * `getClaims` re-fetches the JWKS for a `kid` it has not cached, and for a
   * `kid` the JWKS does not list asks Supabase Auth instead. This guard runs
   * on every request before authentication, so a `kid` it does not hold
   * never reaches `getClaims`: it makes the guard read the project's JWKS
   * again, at most once per {@link JWKS_REFRESH_INTERVAL_MS} process-wide and
   * one read at a time, and the token is checked if that read lists it. The
   * keys come from the project's own Auth server, never from a request, so a
   * caller cannot add to them.
   *
   * Any failure that is not about the token (no client wired, the JWKS not
   * read yet or unreachable, a thrown error) is `unavailable` and therefore
   * per-IP keying, never a rejected request: this guard limits rates,
   * `SupabaseAuthGuard` decides authentication.
   */
  private async jwksVerdict(
    token: string,
    kid: string | undefined,
  ): Promise<Verification> {
    if (!this.supabase) {
      return UNAVAILABLE;
    }
    if (kid === undefined) {
      // Supabase names the key on every token it signs asymmetrically.
      return UNKNOWN;
    }
    let key = this.signingKeys.get(kid);
    if (!key) {
      await this.refreshSigningKeys();
      key = this.signingKeys.get(kid);
      if (!key) {
        return this.signingKeysCurrent ? UNKNOWN : UNAVAILABLE;
      }
    }
    try {
      const { data, error } = await this.supabase.auth.getClaims(token, {
        jwks: { keys: [key] },
      });
      if (data?.claims) {
        return verifiedOrRejected(data.claims);
      }
      // `invalid_jwt` is supabase-js's verdict on the token itself: a bad
      // signature, an expired or malformed one. Anything else is not.
      return error?.code === 'invalid_jwt' ? REJECTED : UNAVAILABLE;
    } catch {
      return UNAVAILABLE;
    }
  }

  /**
   * Waits for a read of the project's JWKS that may list a `kid` not held:
   * the one in flight (boot's, or one another request started), else a new
   * one when {@link JWKS_REFRESH_INTERVAL_MS} has passed since the last began.
   * Otherwise returns at once, and the token stays unchecked.
   */
  private async refreshSigningKeys(): Promise<void> {
    if (
      this.signingKeysRead !== null ||
      Date.now() >= this.nextSigningKeysReadAt
    ) {
      await this.readSigningKeys();
    }
  }

  /**
   * Reads the project's JWKS and replaces {@link signingKeys} with what it
   * lists. One read at a time: a call while one is in flight joins it. A
   * failure keeps the keys already held, logs a warning, and leaves tokens
   * whose `kid` is not among them `unavailable` until a later read succeeds.
   *
   * The request is the one supabase-js's own `fetchJwk` makes: the same URL,
   * with the same `apikey` and `Authorization` headers it sends to Auth, here
   * the API's own key. Neither the key nor the URL is ever logged.
   */
  private readSigningKeys(): Promise<void> {
    if (this.signingKeysRead) {
      return this.signingKeysRead;
    }
    this.nextSigningKeysReadAt = Date.now() + JWKS_REFRESH_INTERVAL_MS;
    this.signingKeysRead = this.fetchSigningKeys().finally(() => {
      this.signingKeysRead = null;
    });
    return this.signingKeysRead;
  }

  private async fetchSigningKeys(): Promise<void> {
    const base = process.env.SUPABASE_URL;
    const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !apiKey) {
      this.signingKeysCurrent = false;
      this.keysLogger.warn(
        'Cannot read the project signing keys: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. ES256/RS256 tokens are keyed by address.',
      );
      return;
    }
    let failure: string;
    try {
      const res = await fetch(
        `${base.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`,
        {
          headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(JWKS_READ_TIMEOUT_MS),
        },
      );
      if (res.ok) {
        const body = (await res.json()) as { keys?: unknown } | null;
        if (Array.isArray(body?.keys)) {
          const keys = new Map<string, JWK>();
          for (const key of body.keys as unknown[]) {
            const kid = (key as { kid?: unknown } | null)?.kid;
            if (typeof kid === 'string' && kid.length > 0) {
              keys.set(kid, key as JWK);
            }
          }
          this.signingKeys = keys;
          this.signingKeysCurrent = true;
          return;
        }
        failure = 'the response had no key list';
      } else {
        failure = `HTTP ${res.status}`;
      }
    } catch (error) {
      failure = error instanceof Error ? error.name : 'an unknown error';
    }
    this.signingKeysCurrent = false;
    this.keysLogger.warn(
      `Could not read the project signing keys (${failure}). Tokens naming a key not already held are keyed by address until a read succeeds; the next is tried at most ${JWKS_REFRESH_INTERVAL_MS / 1000} s from now, when such a token arrives.`,
    );
  }

  /**
   * The project's signing keys by `kid`, as its JWKS listed them at the last
   * read that succeeded.
   */
  private signingKeys = new Map<string, JWK>();

  /** Whether the last read of the JWKS succeeded. */
  private signingKeysCurrent = false;

  /** The read of the JWKS in flight, if any (`readSigningKeys`). */
  private signingKeysRead: Promise<void> | null = null;

  /** Earliest time an unknown `kid` may start another read of the JWKS. */
  private nextSigningKeysReadAt = 0;
}

/**
 * What the guard made of a request's bearer token.
 *
 * - `none`: no bearer token at all.
 * - `verified`: it verified to a user whose token has not expired.
 * - `rejected`: it is not a live session, and Supabase Auth would refuse it:
 *   not a well-formed JWT, an algorithm Supabase does not sign with, an
 *   expired `exp`, a signature that does not match the key the project
 *   lists, or verified claims with no subject.
 * - `unknown`: it could not be checked although the guard's means of checking
 *   work: a `kid` the project's JWKS did not list when last read, an
 *   asymmetric token with no `kid`, or HS256 without the secret.
 * - `unavailable`: it could not be checked because those means do not work
 *   right now: no Supabase client, the JWKS not read yet or its last read
 *   failed, or the verifier failed for a reason that is not the token.
 */
type TokenVerdict =
  'none' | 'verified' | 'rejected' | 'unknown' | 'unavailable';

/** The verdicts {@link UNVERIFIED_BEARER_THROTTLER} counts. */
const COUNTED_VERDICTS: ReadonlySet<TokenVerdict> = new Set<TokenVerdict>([
  'rejected',
  'unknown',
]);

type Verification =
  | { verdict: 'verified'; claims: JwtPayload; userId: string }
  | { verdict: Exclude<TokenVerdict, 'verified'> };

const NO_TOKEN: Verification = { verdict: 'none' };
const REJECTED: Verification = { verdict: 'rejected' };
const UNKNOWN: Verification = { verdict: 'unknown' };
const UNAVAILABLE: Verification = { verdict: 'unavailable' };

/** Verified when the claims carry an unexpired `exp` and a `sub`. */
function verifiedOrRejected(claims: JwtPayload | null): Verification {
  const userId = claims ? subjectOfUnexpired(claims) : null;
  return claims && userId ? { verdict: 'verified', claims, userId } : REJECTED;
}

/** What the throttler keys one request on, and what its token was. */
interface RequestTracking {
  tracker: string;
  verdict: TokenVerdict;
}

/**
 * Per request, keyed by the request object, so nothing outlives the request
 * and nothing on the request itself can claim a tracking.
 */
const trackingByRequest = new WeakMap<object, Promise<RequestTracking>>();

/** The bearer token a request carries, or `null` when it carries none. */
function bearerToken(req: Record<string, any>): string | null {
  const authHeader = getHeaderValue(
    (req.headers ?? {}) as Record<string, string | string[] | undefined>,
    'authorization',
  );
  return authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null;
}

/**
 * The address a request is counted under when it has no verified user: the
 * client address Express resolved through the measured `trust proxy` hops
 * (`bootstrap.ts`), an IPv6 one cut to its /64 ({@link IPV6_BUCKET_PREFIX}).
 * `undefined` when Express resolved none. Exported so everything that counts
 * or groups callers by address (the calendar feed's failed-lookup limit, the
 * auth-failure spike detector) uses this one notion of an address.
 */
export function clientAddress(req: {
  ips?: unknown;
  ip?: unknown;
}): string | undefined {
  const ips = Array.isArray(req.ips) ? (req.ips as unknown[]) : [];
  const ip: unknown = ips.length > 0 ? ips[0] : req.ip;
  return typeof ip === 'string' && ip.length > 0
    ? normalizeIp(ip, IPV6_BUCKET_PREFIX)
    : undefined;
}

/**
 * The `sub` of a payload whose `exp` is numeric and still in the future, else
 * `null`. A verified Supabase token always carries `exp`; one without it is
 * anomalous and gets no bucket of its own.
 */
function subjectOfUnexpired(payload: {
  sub?: unknown;
  exp?: unknown;
}): string | null {
  if (
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    payload.exp * 1000 <= Date.now()
  ) {
    return null;
  }
  return typeof payload.sub === 'string' && payload.sub.length > 0
    ? payload.sub
    : null;
}
