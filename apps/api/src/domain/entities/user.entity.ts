/**
 * The only user columns a display surface needs: who this is, what to call
 * them, and what to draw. Deliberately excludes every PII column on {@link
 * User} — `email`, `bio`, `graduation_year`, `current_city`,
 * `current_company` — because the chat surface resolves author and DM names on
 * the client, and a display concern must not be the reason a member's contact
 * details reach another member's device (#1000, #986).
 *
 * `display_name` is `NOT NULL DEFAULT ''` in the schema, so an empty string is
 * the real "no name set" case; consumers treat it as unresolved. A deleted
 * account already reads `'Deleted User'` (the `anonymize_user` RPC writes it),
 * so it needs no special handling here.
 */
export interface UserDisplayIdentity {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface User {
  id: string;
  supabase_auth_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  graduation_year: number | null;
  current_city: string | null;
  current_company: string | null;
  /**
   * Persisted active chapter. `custom_access_token_hook` stamps it into the
   * access token as the `active_chapter_id` claim; null means "auto-resolve if
   * the user has exactly one membership" (see spec/behavior/multi-tenancy.md).
   */
  active_chapter_id: string | null;
  /**
   * Tombstone marker set by the `anonymize_user` RPC. A non-null value means
   * the account was deleted: PII columns hold the "Deleted User"
   * representation and the Supabase Auth account is gone (or about to be —
   * auth deletion runs last and retries against this same row). See
   * spec/behavior/data-retention.md "Individual Account Deletion".
   */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
