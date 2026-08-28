/**
 * A chapter-defined custom role (Settings → Roles → Custom). Distinct from the
 * live RBAC `roles` table: `chapter_custom_roles` carries label, rank,
 * capabilities, and a core flag edited in the Roles tab. Members are assigned
 * via `members.custom_role_ids`, and the permission resolver flattens
 * `capabilities` into the effective set alongside live-role permissions
 * (bridge model, spec/behavior/rbac.md). The wildcard `*` is rejected on
 * write and ignored on read, so a custom role can never mint a second
 * President.
 */
export interface ChapterCustomRole {
  id: string;
  chapter_id: string;
  key: string;
  label: string;
  rank: number;
  capabilities: string[];
  core: boolean;
  created_at: string;
  updated_at: string;
}
