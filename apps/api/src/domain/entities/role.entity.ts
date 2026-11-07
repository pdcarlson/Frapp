export interface Role {
  id: string;
  chapter_id: string;
  name: string;
  /**
   * Rename-proof identity for seeded system roles (`SystemRoleKeys`), or `null`
   * for custom roles. Authorization and lifecycle lookups resolve on this
   * rather than on `name`, which chapters may rename freely. Not writable
   * through the API.
   */
  system_key: string | null;
  permissions: string[];
  is_system: boolean;
  display_order: number;
  color: string | null;
  /**
   * Whether any member may `@` this role in chat. On by default; while off,
   * only a member who can manage channels or roles can ping it (2026-11-06).
   */
  mentionable: boolean;
  created_at: string;
}
