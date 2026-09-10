import { Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';

/** Postgres `unique_violation`, as surfaced by PostgREST. */
const UNIQUE_VIOLATION = '23505';

export const PLACEHOLDER_EMAIL_HOST = 'users.invalid';
export const APPLE_PRIVATE_RELAY_HOST = 'privaterelay.appleid.com';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function stringField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isPlaceholderAuthEmail(email: string): boolean {
  return email.split('@')[1]?.toLowerCase() === PLACEHOLDER_EMAIL_HOST;
}

export function isApplePrivateRelayEmail(email: string): boolean {
  return email.split('@')[1]?.toLowerCase() === APPLE_PRIVATE_RELAY_HOST;
}

/**
 * `users.email` is NOT NULL. Native Sign in with Apple may omit email after
 * the first grant, so an empty Auth email cannot be written as `''`.
 */
export function emailForSync(supabaseAuthId: string, email: string): string {
  const trimmed = email.trim();
  if (trimmed.length > 0) return trimmed;
  return `noreply+${supabaseAuthId}@${PLACEHOLDER_EMAIL_HOST}`;
}

/**
 * Adopt a newly seen Auth email onto an existing `users` row.
 *
 * Never replace a university (or other real) address with Apple Hide My
 * Email, and never downgrade a real address to the empty-email placeholder.
 * Collision of two *different* auth users who share an email is GoTrue
 * identity linking — this table is unique on `supabase_auth_id` only.
 */
export function shouldAdoptSyncedEmail(
  current: string,
  incoming: string,
): boolean {
  if (current === incoming) return false;
  if (isPlaceholderAuthEmail(incoming)) return false;
  if (isPlaceholderAuthEmail(current)) return true;
  return (
    isApplePrivateRelayEmail(current) && !isApplePrivateRelayEmail(incoming)
  );
}

export function displayNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const full = stringField(metadata.full_name) ?? stringField(metadata.name);
  if (full) return full;
  const given =
    stringField(metadata.given_name) ?? stringField(metadata.givenName);
  const family =
    stringField(metadata.family_name) ?? stringField(metadata.familyName);
  const combined = [given, family].filter(Boolean).join(' ').trim();
  return combined.length > 0 ? combined : null;
}

export function displayNameForSync(
  email: string,
  metadata?: Record<string, unknown> | null,
): string {
  const fromMeta = displayNameFromMetadata(metadata);
  if (fromMeta) return fromMeta;
  if (isPlaceholderAuthEmail(email) || isApplePrivateRelayEmail(email)) {
    return 'Member';
  }
  const local = email.split('@')[0] ?? '';
  return local.length > 0 ? local : 'Member';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
  ) {}

  /**
   * Ensure a `users` row exists for this Supabase Auth id.
   *
   * The interceptor that calls this runs on every authenticated request.
   * A first session therefore races: the client fires several GETs at once,
   * each `find` misses, and the losing insert raises `users_supabase_auth_id_key`
   * (production Sentry FRAPP-API-3 on GET /v1/chapters + GET /v1/analytics/identity).
   * Treat that unique violation as "the other request won" and return the row.
   */
  async syncUser(
    supabaseAuthId: string,
    email: string,
    metadata?: Record<string, unknown> | null,
  ): Promise<{ id: string }> {
    const syncedEmail = emailForSync(supabaseAuthId, email);
    const displayName = displayNameForSync(syncedEmail, metadata);
    const existing = await this.userRepo.findBySupabaseAuthId(supabaseAuthId);
    if (existing) {
      const patch: { email?: string; display_name?: string } = {};
      if (shouldAdoptSyncedEmail(existing.email, syncedEmail)) {
        patch.email = syncedEmail;
      }
      // Schema is NOT NULL DEFAULT ''. An omitted column is not an empty
      // name — skip the fill rather than 500 on `.trim()`.
      if (
        typeof existing.display_name === 'string' &&
        !existing.display_name.trim()
      ) {
        patch.display_name = displayName;
      }
      if (Object.keys(patch).length > 0) {
        await this.userRepo.update(existing.id, patch);
      }
      return { id: existing.id };
    }

    try {
      const user = await this.userRepo.create({
        supabase_auth_id: supabaseAuthId,
        email: syncedEmail,
        display_name: displayName,
      });
      return { id: user.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.userRepo.findBySupabaseAuthId(supabaseAuthId);
      if (raced) return { id: raced.id };
      throw error;
    }
  }
}
