import { SetMetadata } from '@nestjs/common';

export const VERIFY_SESSION_LOCALLY_KEY = 'verify_session_locally';

/**
 * Lets a chapter-scoped read verify the caller's access token locally instead
 * of asking Supabase Auth (`auth.getUser`) on every request (#5043, Paul
 * 2026-11-16). `SupabaseAuthGuard` takes the local path only when all of
 * these hold, and calls `getUser` otherwise:
 *
 * - this handler carries the marker (a method decorator only: a class-level
 *   marker would silently opt in every `GET` added to the controller later);
 * - the request is a `GET` or `HEAD`, so a write always checks its session;
 * - `ChapterGuard` runs on the route, which re-reads the caller's `users` row
 *   (refusing a deleted one) and membership on every request;
 * - the throttler verified the token's signature first, so an unknown signing
 *   key never reaches the JWKS fetch from here.
 *
 * The cost is the staleness bound spec/behavior/multi-tenancy.md records: a
 * signed-out or revoked session can keep making these reads until its access
 * token expires (`jwt_expiry`). So never mark a read that returns credentials,
 * a signed URL to a private file, an export or account data, or admin and
 * audit records. Such a route keeps `getUser` by leaving the marker off; that
 * is the default. A locally verified request carries no Auth user record, and
 * `@CurrentVerifiedEmail()` throws on one rather than answer without it.
 */
export const VerifySessionLocally = (): MethodDecorator =>
  SetMetadata(VERIFY_SESSION_LOCALLY_KEY, true);
