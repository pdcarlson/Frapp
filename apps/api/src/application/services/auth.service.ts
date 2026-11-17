import { Inject, Injectable } from '@nestjs/common';
import { DISPLAY_NAME_MAX_LENGTH } from '@repo/validation';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';

const PLACEHOLDER_EMAIL_HOST = 'users.invalid';
const APPLE_PRIVATE_RELAY_HOST = 'privaterelay.appleid.com';

function stringField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlaceholderAuthEmail(email: string): boolean {
  return email.split('@')[1]?.toLowerCase() === PLACEHOLDER_EMAIL_HOST;
}

function isApplePrivateRelayEmail(email: string): boolean {
  return email.split('@')[1]?.toLowerCase() === APPLE_PRIVATE_RELAY_HOST;
}

/**
 * `users.email` is NOT NULL. Native Sign in with Apple may omit email after
 * the first grant, so an empty Auth email cannot be written as `''`.
 */
function emailForSync(supabaseAuthId: string, email: string): string {
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
function shouldAdoptSyncedEmail(current: string, incoming: string): boolean {
  if (current === incoming) return false;
  if (isPlaceholderAuthEmail(incoming)) return false;
  if (isPlaceholderAuthEmail(current)) return true;
  return (
    isApplePrivateRelayEmail(current) && !isApplePrivateRelayEmail(incoming)
  );
}

function displayNameFromMetadata(
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

/** The name stored when sign-in carried none and the email gives none away. */
const PLACEHOLDER_DISPLAY_NAME = 'Member';

/**
 * The name sign-in stores, cut to the length a member may give their own
 * (`DISPLAY_NAME_MAX_LENGTH`). The provider's metadata is whatever the
 * account holder typed there, so without the cut a long one would be stored,
 * shown everywhere the member is named, and make the member's own profile
 * save refuse a name they never typed. Cut by character, so an emoji or an
 * accented letter at the edge is kept whole or dropped, never split.
 */
function displayNameForSync(
  email: string,
  metadata?: Record<string, unknown> | null,
): string {
  return clampDisplayName(unclampedDisplayName(email, metadata));
}

function unclampedDisplayName(
  email: string,
  metadata?: Record<string, unknown> | null,
): string {
  const fromMeta = displayNameFromMetadata(metadata);
  if (fromMeta) return fromMeta;
  if (isPlaceholderAuthEmail(email) || isApplePrivateRelayEmail(email)) {
    return PLACEHOLDER_DISPLAY_NAME;
  }
  const local = email.split('@')[0] ?? '';
  return local.length > 0 ? local : PLACEHOLDER_DISPLAY_NAME;
}

function clampDisplayName(name: string): string {
  const characters = Array.from(name.trim());
  if (characters.length <= DISPLAY_NAME_MAX_LENGTH) return name.trim();
  return characters.slice(0, DISPLAY_NAME_MAX_LENGTH).join('').trimEnd();
}

/**
 * Whether a sync fills in the stored name. An empty one always takes the
 * fallback; the `Member` stand-in gives way only to a real name from the
 * sign-in metadata. That second case is Sign in with Apple: the app signs in
 * first and writes the name Apple handed over to the auth metadata a moment
 * later (`apps/mobile/lib/apple-auth.ts`), so the first request can create
 * the row as `Member` before the name exists. Without this the name Apple
 * gives only once was never adopted. A name the member typed is never
 * replaced.
 */
function shouldFillDisplayName(
  stored: unknown,
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (typeof stored !== 'string') return false;
  const current = stored.trim();
  if (!current) return true;
  return (
    current === PLACEHOLDER_DISPLAY_NAME &&
    displayNameFromMetadata(metadata) !== null
  );
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
      if (shouldFillDisplayName(existing.display_name, metadata)) {
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
