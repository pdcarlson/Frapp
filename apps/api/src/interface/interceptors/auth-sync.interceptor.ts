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
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import type { RequestContext } from '../types/request-context.types';

/** How many sessions' last sync one process remembers. */
const REMEMBERED_SESSIONS = 5_000;

/**
 * How long one process trusts its memo before syncing the same session again.
 * Another instance, or a database edit, may have changed the row since, so
 * the memo only saves reads for a while.
 */
const REMEMBER_FOR_MS = 10 * 60 * 1000;

/**
 * Resolves the caller's `users` row (`request.appUser`) and keeps its email
 * and display name in step with the Auth session (`AuthService.syncUser`).
 *
 * When a guard has already resolved the row this request (`ChapterGuard` sets
 * `request.appUser`), nothing here decides access, so the request does not
 * wait on the sync: it runs in the background, and only when this session's
 * email or metadata differs from what this process last synced for it, or
 * that was over `REMEMBER_FOR_MS` ago. Before this, every chapter request
 * re-read its `users` row after the guards, one more serial round trip that
 * took about 750 ms when an app open's burst filled PostgREST's pool
 * (2026-11-12). Membership and role checks are untouched and still run per
 * request (#3752).
 *
 * A route with no such guard still waits, because the sync is what finds (or,
 * on first sign-in, creates) the row.
 */
@Injectable()
export class AuthSyncInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuthSyncInterceptor.name);
  private readonly synced = new Map<
    string,
    { signature: string; at: number }
  >();

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
      const resolved = request.appUser?.id;

      let id: string;
      if (resolved) {
        id = resolved;
        this.syncInBackground(authId, email, metadata);
      } else {
        ({ id } = await this.authService.syncUser(authId, email, metadata));
        this.remember(authId, signatureOf(email, metadata));
        request.appUser = { id };
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
  ): void {
    const signature = signatureOf(email, metadata);
    const known = this.synced.get(authId);
    if (
      known?.signature === signature &&
      Date.now() - known.at < REMEMBER_FOR_MS
    ) {
      return;
    }

    this.remember(authId, signature);
    this.authService
      .syncUser(authId, email, metadata)
      .catch((error: unknown) => {
        // Forget it, so the session's next request tries again.
        if (this.synced.get(authId)?.signature === signature) {
          this.synced.delete(authId);
        }
        logThrowable(
          this.logger,
          'warn',
          `Failed to sync the users row for auth user ${authId}`,
          error,
        );
      });
  }

  private remember(authId: string, signature: string): void {
    // A Map iterates in insertion order, so re-inserting keeps the most recent
    // sessions at the end and the first key is the one heard from longest ago.
    this.synced.delete(authId);
    this.synced.set(authId, { signature, at: Date.now() });
    if (this.synced.size > REMEMBERED_SESSIONS) {
      for (const oldest of this.synced.keys()) {
        this.synced.delete(oldest);
        break;
      }
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
