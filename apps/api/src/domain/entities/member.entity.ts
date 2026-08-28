export interface Member {
  id: string;
  user_id: string;
  chapter_id: string;
  role_ids: string[];
  /** Assigned `chapter_custom_roles` ids; capabilities flatten into the permission set alongside `role_ids`. */
  custom_role_ids: string[];
  has_completed_onboarding: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A chapter member reduced to what naming them requires: their `users.id` and
 * the display name a mention or slash-command resolves against.
 *
 * Deliberately narrower than {@link Member} joined to a full user row. The chat
 * send path resolves `@`-mentions on every message, and the roster it resolves
 * against used to arrive as whole `users` rows — marshalling `email`, `bio` and
 * `graduation_year` past the service layer on each send for two columns' worth
 * of use (#986). This is the same boundary `UserDisplayIdentity` draws for the
 * chat *display* path (#1000), minus `avatar_url`, which mention resolution
 * never reads.
 *
 * `user_id` rather than `id` so the shape matches `MentionCandidate` in
 * `@repo/validation` structurally, and the resolver can consume it unmapped.
 */
export interface ChapterMemberIdentity {
  /** `users.id` — the application id, not `supabase_auth_id`. */
  user_id: string;
  display_name: string;
}
