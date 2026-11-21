import { readUnverifiedJwtPayload } from '#domain/utils/jwt-segment';

/**
 * What kind of Supabase API key a string is, read from its shape alone.
 *
 * Supabase issues two generations of keys (#2532). The legacy `anon` and
 * `service_role` keys are JWTs signed with the project's JWT secret, and their
 * payload names the role. The newer `sb_publishable_…` and `sb_secret_…` keys
 * are opaque strings that the platform gateway translates into those roles.
 * The legacy pair stops working at the end of 2026, and the API's
 * `SUPABASE_SERVICE_ROLE_KEY` may hold either generation until then: the
 * variable keeps its name through the migration, so the swap is a value change
 * in Infisical rather than a coordinated rename.
 *
 * Supabase's clients accept either generation in the same slot (measured
 * against the local stack for REST, Storage, Auth admin and Realtime), so the
 * API itself never needs to know which one it holds. `env.validation.ts` asks
 * only to refuse a CLIENT key in the service slot.
 *
 * `unrecognized` covers test stand-ins and anything else; callers treat it as
 * "cannot tell", never as a verdict.
 */
export type SupabaseKeyKind =
  'secret' | 'publishable' | 'service_role_jwt' | 'client_jwt' | 'unrecognized';

export function classifySupabaseKey(raw: string): SupabaseKeyKind {
  const value = raw.trim();
  if (value.startsWith('sb_secret_')) return 'secret';
  if (value.startsWith('sb_publishable_')) return 'publishable';
  const role = readUnverifiedJwtPayload(value)?.role;
  if (role === 'service_role') return 'service_role_jwt';
  return typeof role === 'string' ? 'client_jwt' : 'unrecognized';
}
