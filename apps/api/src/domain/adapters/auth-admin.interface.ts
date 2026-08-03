export const AUTH_ADMIN_PROVIDER = 'AUTH_ADMIN_PROVIDER';

/**
 * Administrative operations against the identity provider (Supabase Auth).
 * Deliberately minimal: account deletion is the only admin capability the
 * application layer is allowed to reach today.
 */
export interface IAuthAdminProvider {
  /**
   * Permanently delete the auth account for `supabaseAuthId`. Idempotent:
   * an already-deleted (unknown) auth user resolves successfully so the
   * account-deletion flow can be retried after partial failures. Any other
   * provider error rejects.
   */
  deleteAuthUser(supabaseAuthId: string): Promise<void>;
}
