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
