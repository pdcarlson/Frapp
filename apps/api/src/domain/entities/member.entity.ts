export interface Member {
  id: string;
  user_id: string;
  chapter_id: string;
  role_ids: string[];
  /**
   * Always empty since #4075 folded custom roles into `role_ids`. The column
   * stays until the table drop (#4194); nothing writes or reads it for access.
   */
  custom_role_ids: string[];
  has_completed_onboarding: boolean;
  /**
   * `MODULE_CATALOG` keys whose ops-setup nudge this member has dismissed in
   * this chapter. Per-user-per-chapter by virtue of living on the member row
   * (`unique (user_id, chapter_id)`), which is what `spec/product/modules.md`
   * § "Ops-setup nudges" requires — see #492.
   */
  dismissed_ops_nudges: string[];
  /**
   * The `chapter_pledge_classes` row this member belongs to, or null (#3939).
   * Always a class of the member's own chapter (composite foreign key).
   */
  pledge_class_id: string | null;
  /**
   * The member's order within their pledge class, or chapter-wide (a roll or
   * bond number), set by officers. Null when the chapter keeps none.
   */
  order_number: number | null;
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
  /**
   * `members.role_ids`, so `@`-resolution can expand a role mention to its
   * holders without a second read (2026-11-06). Empty when the column held
   * anything but strings.
   */
  role_ids: string[];
}
