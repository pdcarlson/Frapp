import { Throttle } from '@nestjs/throttler';

/**
 * Per-route rate-limit profiles for endpoints that cost real money or fan out
 * beyond the caller (#850).
 *
 * ## Why these override `read`/`write` instead of adding a named bucket
 *
 * `ThrottlerGuard.generateKey` hashes
 * `${ClassName}-${HandlerName}-${throttlerName}-${tracker}`, so every handler
 * already owns a private counter per caller. The app-wide `read` 100/min and
 * `write` 30/min registered in `AppModule` are therefore *per endpoint*, not a
 * shared pool — the ceiling this file lowers is "30 report generations a
 * minute, forever", which is ~43k/day against a route that aggregates a whole
 * chapter.
 *
 * A third named throttler (`expensive`) would be registered globally and so
 * would run on **every** route in the app, forcing `CustomThrottlerGuard` to
 * learn a third gating rule to keep it off the other 90 handlers. Overriding
 * the existing bucket's limit on the handlers that need it is the same result
 * with no new global state, and it composes with the guard's existing
 * method gating (`write` is already skipped for GET/HEAD/OPTIONS, `read` for
 * everything else) untouched.
 *
 * ## Choosing a profile
 *
 * The numbers are deliberately generous against *human* use and hostile only to
 * scripted use: a treasurer exporting every report on the page still fits in
 * {@link ThrottleExpensiveWrite}, and 20 searches a minute is faster than
 * anyone types. They are plain constants rather than chapter configuration
 * because nothing in the product exposes a knob for them — see
 * `spec/behavior/README.md` § Rate Limiting.
 *
 * Overriding a bucket does not change *which* bucket a route lands in, so a
 * `read` profile on a POST route (or vice versa) is silently inert. Match the
 * profile to the HTTP method.
 */
const MINUTE_MS = 60_000;

/**
 * 5/min — full-chapter aggregation, export rendering, or bulk token minting.
 * One request here can touch every row a chapter owns.
 */
export const ThrottleExpensiveWrite = () =>
  Throttle({ write: { limit: 5, ttl: MINUTE_MS } });

/**
 * 10/min — the request cheap, its consequence not: a push notification to every
 * member, a signed URL that unlocks object storage, or a guess at a credential.
 */
export const ThrottleFanOutWrite = () =>
  Throttle({ write: { limit: 10, ttl: MINUTE_MS } });

/**
 * 20/min — a read whose database cost is superlinear in the caller's input.
 * Only for GET routes; `write` routes are not gated by this bucket.
 */
export const ThrottleExpensiveRead = () =>
  Throttle({ read: { limit: 20, ttl: MINUTE_MS } });
