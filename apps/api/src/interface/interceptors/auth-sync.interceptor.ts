import {
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthService } from '../../application/services/auth.service';
import { TimeZoneSyncService } from '../../application/services/time-zone-sync.service';
import { TIME_ZONE_HEADER } from '#domain/constants/time-zone-header';
import { InFlightLookups } from '../../infrastructure/supabase/in-flight-lookups';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import type { RequestContext } from '../types/request-context.types';

/** How many sessions' last sync the process remembers. */
const REMEMBERED_SESSIONS = 5_000;

/**
 * How long the process trusts its memo before syncing the same session again.
 * Another instance, or a database edit, may have changed the row since, so
 * the memo only saves reads for a while.
 */
const REMEMBER_FOR_MS = 10 * 60 * 1000;

/**
 * Process-wide, not per interceptor instance: six modules provide this
 * interceptor, Nest builds one per module, and one app open hits several of
 * their routes. Keyed by auth user id; the value is the session signature
 * (`signatureOf`) last synced and when.
 */
const synced = new Map<string, { signature: string; at: number }>();

/**
 * A sync the request waits on, shared by the requests of one burst that carry
 * the same session (`${authId}:${signature}`): they would all make the same
 * `users` read, and the same write if one is due.
 */
const waitedSyncs = new InFlightLookups<{ id: string }>();

/**
 * Resolves the caller's `users` row (`request.appUser`) and keeps its email
 * and display name in step with the Auth session (`AuthService.syncUser`).
 *
 * When a guard has already resolved the row this request (`ChapterGuard` sets
 * `request.appUser`; guards run before interceptors), nothing here decides
 * access, so the request does not wait on the sync: it runs in the
 * background, and only when the process has not synced this session's email
 * and metadata in the last `REMEMBER_FOR_MS`. Before this, every chapter
 * request re-read its `users` row after the guards, one more serial round
 * trip that took about 750 ms when an app open's burst filled PostgREST's
 * pool (2026-11-12).
 *
 * Two cases still wait:
 * - A route with no such guard, because the sync is what finds (or, on first
 *   sign-in, creates) the row.
 * - A session whose email or metadata changed since the process last synced
 *   it, such as the Apple name that reaches the Auth metadata after the row
 *   was created as "Member", so the handler reads the row as it now is.
 *
 * Both share one sync across a burst (`waitedSyncs`).
 */
@Injectable()
export class AuthSyncInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuthSyncInterceptor.name);

  constructor(
    private readonly authService: AuthService,
    private readonly timeZones: TimeZoneSyncService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const supabaseUser = request.supabaseUser;

    if (supabaseUser) {
      const authId = supabaseUser.id;
      const email = supabaseUser.email ?? '';
      const metadata = supabaseUser.user_metadata;
      const signature = signatureOf(email, metadata);
      const resolved = request.appUser?.id;
      const known = synced.get(authId);
      const changed = known !== undefined && known.signature !== signature;

      let id: string;
      if (resolved && !changed) {
        id = resolved;
        this.syncInBackground(authId, email, metadata, signature);
      } else {
        ({ id } = await waitedSyncs.run(`${authId}:${signature}`, () =>
          this.authService.syncUser(authId, email, metadata),
        ));
        remember(authId, signature);
        request.appUser ??= { id };
      }
      // Fire-and-forget: pushes name times in this zone, and the request
      // never waits on recording it.
      // Never on a DELETE: account deletion is one, and an upsert racing its
      // `anonymize_user` could recreate the settings row it just removed.
      if (request.method !== 'DELETE') {
        this.timeZones.record(id, request.headers?.[TIME_ZONE_HEADER]);
      }
    }

    return next.handle().pipe(tap());
  }

  private syncInBackground(
    authId: string,
    email: string,
    metadata: Record<string, unknown> | null | undefined,
    signature: string,
  ): void {
    const known = synced.get(authId);
    if (
      known?.signature === signature &&
      Date.now() - known.at < REMEMBER_FOR_MS
    ) {
      return;
    }

    remember(authId, signature);
    this.authService
      .syncUser(authId, email, metadata)
      .catch((error: unknown) => {
        // Forget it, so the session's next request tries again.
        if (synced.get(authId)?.signature === signature) {
          synced.delete(authId);
        }
        logThrowable(
          this.logger,
          'warn',
          `Failed to sync the users row for auth user ${authId}`,
          error,
        );
      });
  }
}

function remember(authId: string, signature: string): void {
  // A Map iterates in insertion order, so re-inserting keeps the most recent
  // sessions at the end and the first key is the one heard from longest ago.
  synced.delete(authId);
  synced.set(authId, { signature, at: Date.now() });
  if (synced.size > REMEMBERED_SESSIONS) {
    for (const oldest of synced.keys()) {
      synced.delete(oldest);
      break;
    }
  }
}

/** What `syncUser` reads from the session: a change in either syncs again. */
function signatureOf(
  email: string,
  metadata: Record<string, unknown> | null | undefined,
): string {
  return JSON.stringify([email, metadata ?? null]);
}
