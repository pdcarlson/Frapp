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
  created_at: string;
  updated_at: string;
}
