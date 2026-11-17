import { ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
  normalizeIp,
} from '@nestjs/throttler';
import { createHash, createHmac } from 'node:crypto';
import type { Response } from 'express';
import type { JwtPayload } from '@supabase/supabase-js';
import { getHeaderValue } from '../types/request-context.types';
import { constantTimeEquals } from '#domain/utils/constant-time';
import { decodeJwtSegment } from '#domain/utils/jwt-segment';
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
 * How often a token whose `kid` has never verified may reach the JWKS
 * verifier (see `jwksClaims`). Ten seconds bounds a random-`kid` flood to six
 * outbound JWKS fetches a minute for the whole process, and delays a genuine
 * key rotation's first per-user bucket by at most that long.
 */
export const UNKNOWN_KID_ATTEMPT_INTERVAL_MS = 10_000;

/**
 * How long the boot-time read of the project's signing keys may take (see
 * `seedKnownKids`). Requests whose `kid` is not yet known wait for it, so it
 * is short; when it runs out, the guard learns `kid`s as it did before.
 */
export const KID_SEED_TIMEOUT_MS = 3_000;

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
 * Signed-in members are not counted: their tokens verify and are keyed per
 * user, so a chapter of 100 opening the app on one campus network never comes
 * near it. Calls with no token at all (the health checks, the version check,
 * an invite preview before sign-in) are not counted either: without a token
 * the auth guard refuses before any outbound call. What lands here from real
 * members is a token that went stale a moment before the app refreshed it,
 * and the few seconds after a signing-key rotation before its new `kid` is
 * learned. Product choice: generous for those, and still a small fraction of
 * what the per-route buckets allowed one address in total.
 */
export const UNVERIFIED_BEARER_LIMIT = 200;

/** The window {@link UNVERIFIED_BEARER_LIMIT} counts over. */
export const UNVERIFIED_BEARER_TTL_MS = 60_000;

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
   * - **ES256 / RS256** — checked with `supabase.auth.getClaims()`, which
   *   verifies against the project's JWKS with WebCrypto and caches the key set,
   *   so after the first fetch it is a local signature check, not a network
   *   round trip. Both hosted Frapp projects sign ES256 (`HS256` is
   *   `previously_used` on each) and so does the local stack the pinned CLI
   *   starts, so before this path existed no request anywhere was keyed per
   *   user — the secret would not have verified those tokens even if it had
   *   been set, and `SupabaseAuthGuard` says as much about its own
   *   `getClaims()` call.
   *
   * Requests without a valid, unexpired token fall back to per-IP keying, which
   * preserves the original denial-of-service protection; those that sent a
   * token are also counted in the shared {@link UNVERIFIED_BEARER_THROTTLER}
   * bucket (`handleRequest`).
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return (await this.tracking(req)).tracker;
  }

  /**
   * One request's tracker, worked out once. The base guard asks for it once
   * per throttler that runs, and the token check behind it must run once: a
   * second `getClaims` would be a second verification, and for an unknown
   * `kid` would spend the next attempt slot on the same token.
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
    const claims = await this.verifiedClaims(req);
    const userId = claims ? subjectOfUnexpired(claims) : null;
    if (claims && userId) {
      // Handed on so `SupabaseAuthGuard` can start the chapter lookups on
      // this verified `sub` (#3728). On a read marked
      // `@VerifySessionLocally()` (#5043) that guard verifies the token again
      // itself, but only when these claims are present: so a token whose
      // `kid` this guard's unknown-`kid` bound below kept from the JWKS
      // verifier never reaches one from there either. Keep that
      // precondition.
      (
        req as { throttlerVerifiedClaims?: JwtPayload }
      ).throttlerVerifiedClaims = claims;
      return { tracker: `user:${userId}`, unverifiedBearer: false };
    }
    return {
      tracker: `ip:${clientAddress(req)}`,
      unverifiedBearer: bearerToken(req) !== null,
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

    // Every method, but only a request whose bearer token did not verify
    // (`UNVERIFIED_BEARER_LIMIT`): a signed-in member's request, and one with
    // no token at all, pass this throttler untouched.
    if (throttler.name === UNVERIFIED_BEARER_THROTTLER) {
      const { unverifiedBearer } = await this.tracking(
        request as Record<string, any>,
      );
      if (!unverifiedBearer) {
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
   * Learn the project's signing-key ids at boot. A `kid` is otherwise learned
   * on its first successful verification, and until then shares one attempt
   * per `UNKNOWN_KID_ATTEMPT_INTERVAL_MS` with every other unknown `kid`, so
   * right after a deploy a stream of made-up `kid`s could keep taking that
   * slot and leave real members keyed per address (and counted in the
   * unverified-token bucket). Not awaited, so boot never waits on the
   * network; a request with an unknown `kid` waits for it instead
   * (`jwksClaims`), at most {@link KID_SEED_TIMEOUT_MS}.
   */
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.kidSeed = this.seedKnownKids();
  }

  /** Every throttled request, any bucket, reads {@link THROTTLED_MESSAGE}. */
  protected getErrorMessage(): Promise<string> {
    return Promise.resolve(THROTTLED_MESSAGE);
  }

  /**
   * Emit a standard, unsuffixed `Retry-After` header (in seconds) on 429s.
   * Because we register *named* throttlers (`read`/`write`), the base guard
   * only sets a name-suffixed header (`Retry-After-read` / `Retry-After-write`)
   * that HTTP clients do not honour, so we add the canonical one here.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    res.header('Retry-After', String(throttlerLimitDetail.timeToBlockExpire));
    await super.throwThrottlingException(context, throttlerLimitDetail);
  }

  /**
   * Return the claims of a cryptographically verified Supabase access token on
   * the request, or `null` (missing/malformed/invalid token, or no verifier
   * available for its `alg`) so callers fall back to per-IP keying. The
   * caller still checks `exp` and `sub` (`subjectOfUnexpired`).
   */
  private async verifiedClaims(
    req: Record<string, any>,
  ): Promise<JwtPayload | null> {
    const token = bearerToken(req);
    if (token === null) {
      return null;
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      return null;
    }
    const [headerSeg, payloadSeg, signatureSeg] = segments;

    // A header that isn't a JSON object (unparseable, `null`, a number)
    // carries no `alg`: fall back to per-IP keying, as the payload path does.
    const decodedHeader = decodeJwtSegment(headerSeg);
    if (decodedHeader === null || typeof decodedHeader !== 'object') {
      return null;
    }
    const header = decodedHeader as { alg?: unknown; kid?: unknown };

    if (header.alg === 'HS256') {
      return this.hs256Claims(headerSeg, payloadSeg, signatureSeg);
    }
    if (typeof header.alg === 'string' && JWKS_VERIFIED_ALGS.has(header.alg)) {
      return this.jwksClaims(
        token,
        typeof header.kid === 'string' ? header.kid : undefined,
      );
    }
    // `none`, an unknown alg, or no alg at all: nothing here can verify it.
    return null;
  }

  /**
   * HS256 — the local Supabase stack's algorithm — verified against
   * `SUPABASE_JWT_SECRET`. Without the secret there is no way to check the
   * signature, so the token yields no subject rather than an unverified one.
   */
  private hs256Claims(
    headerSeg: string,
    payloadSeg: string,
    signatureSeg: string,
  ): JwtPayload | null {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      return null;
    }

    const expected = createHmac('sha256', secret)
      .update(`${headerSeg}.${payloadSeg}`)
      .digest('base64url');
    if (!constantTimeEquals(signatureSeg, expected)) {
      return null;
    }

    const payload = decodeJwtSegment(payloadSeg);
    return payload !== null && typeof payload === 'object'
      ? (payload as JwtPayload)
      : null;
  }

  /**
   * ES256 / RS256 — verified by supabase-js against the project JWKS (cached
   * after the first fetch; WebCrypto locally thereafter). `getClaims` already
   * rejects a bad signature and an expired token, and the `exp` re-check below
   * is the same belt the HS256 path wears: a claims object with no usable
   * `exp` must not become a perpetual per-user bucket. Any failure — no client
   * wired, JWKS unreachable on a cold start, verification error — is a `null`
   * and therefore per-IP keying, never a rejected request: this guard limits
   * rates, `SupabaseAuthGuard` decides authentication.
   *
   * One thing supabase-js does not do is negative-cache: `fetchJwk` re-fetches
   * the JWKS over the network whenever a token's `kid` is not in its cache,
   * and this guard runs on every request *before* authentication. Unbounded,
   * that is an amplifier — an unauthenticated flood of ES256-shaped headers
   * with random `kid`s becomes one outbound fetch each. So a `kid` earns the
   * verifier's attention once: a `kid` that has verified before is always
   * sent (real members share one or two, and a key rotation is a single new
   * one); any other `kid` gets at most one attempt per
   * `UNKNOWN_KID_ATTEMPT_INTERVAL_MS`, process-wide, and everything in between
   * keys on IP — the pre-existing, safe behaviour. A `kid` is added to the
   * known set only on a successful verification, so an attacker cannot grow
   * it.
   */
  private async jwksClaims(
    token: string,
    kid: string | undefined,
  ): Promise<JwtPayload | null> {
    if (!this.supabase) {
      return null;
    }
    let known = kid !== undefined && this.verifiedKids.has(kid);
    if (!known && kid !== undefined) {
      // Already settled once boot's JWKS read is done; until then it may
      // still name this `kid`.
      await this.kidSeed;
      known = this.verifiedKids.has(kid);
    }
    if (!known) {
      const now = Date.now();
      if (now < this.nextUnknownKidAttemptAt) {
        return null;
      }
      this.nextUnknownKidAttemptAt = now + UNKNOWN_KID_ATTEMPT_INTERVAL_MS;
    }
    try {
      const { data, error } = await this.supabase.auth.getClaims(token);
      if (error || !data?.claims) {
        return null;
      }
      if (kid !== undefined) {
        this.verifiedKids.add(kid);
      }
      return data.claims;
    } catch {
      return null;
    }
  }

  /**
   * Adds every `kid` the project's JWKS lists to the known set. They come from
   * the project's own Auth server, not from a request, so no caller can grow
   * the set this way. Any failure (no client or URL wired, Auth unreachable,
   * an unexpected body) leaves the set as it was, and `kid`s are learned on
   * first verification as before.
   */
  private async seedKnownKids(): Promise<void> {
    const base = process.env.SUPABASE_URL;
    if (!this.supabase || !base) {
      return;
    }
    try {
      const res = await fetch(
        `${base.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`,
        { signal: AbortSignal.timeout(KID_SEED_TIMEOUT_MS) },
      );
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as { keys?: unknown } | null;
      const keys: unknown[] = Array.isArray(body?.keys) ? body.keys : [];
      for (const key of keys) {
        const kid = (key as { kid?: unknown } | null)?.kid;
        if (typeof kid === 'string' && kid.length > 0) {
          this.verifiedKids.add(kid);
        }
      }
    } catch {
      // Learned on first verification instead (see above).
    }
  }

  /**
   * `kid`s known to be the project's: listed by its JWKS at boot, or verified
   * against it at least once.
   */
  private readonly verifiedKids = new Set<string>();

  /** Boot's JWKS read (`seedKnownKids`); it never rejects. */
  private kidSeed: Promise<void> = Promise.resolve();

  /** Earliest time an unknown `kid` may next be sent to the verifier. */
  private nextUnknownKidAttemptAt = 0;
}

/** What the throttler keys one request on, and whether its token failed. */
interface RequestTracking {
  tracker: string;
  /** A bearer token was sent and did not verify to an unexpired user. */
  unverifiedBearer: boolean;
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
 * Exported so the calendar feed's failed-lookup limit counts by the same
 * address.
 */
export function clientAddress(req: Record<string, any>): string {
  const ips = Array.isArray(req.ips) ? (req.ips as unknown[]) : [];
  const ip: unknown = ips.length > 0 ? ips[0] : (req.ip as unknown);
  return typeof ip === 'string'
    ? normalizeIp(ip, IPV6_BUCKET_PREFIX)
    : String(ip);
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
