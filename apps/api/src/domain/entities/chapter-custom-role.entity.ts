/**
 * A chapter-defined custom role (Settings → Roles → Custom). Distinct from the
 * live RBAC `roles` table: `chapter_custom_roles` carries the presentation
 * model (label, rank, capabilities, core flag) edited in the Roles tab. Wiring
 * these into the permission-enforcement algorithm is tracked separately.
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
