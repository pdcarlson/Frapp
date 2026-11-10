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
  /**
   * The role's tier (`role_tiers`), or `null` for a role outside the tiers.
   * A tier gives its roles their starting permissions and their rank (#4071).
   */
  tier_id: string | null;
  /**
   * Permission key to `true` (on for this role whatever its tier says) or
   * `false` (off). `permissions` is always the tier's list with these applied;
   * the database keeps it so (`20261111010000_role_tiers.sql`).
   */
  permission_overrides: Record<string, boolean>;
  created_at: string;
}

/**
 * One of a chapter's tiers of roles (`role_tiers`, #4071).
 *
 * How many a chapter has, what each is called and their order are the
 * chapter's own data: no code may read meaning into a tier's `name` or
 * `position` beyond "a lower position ranks higher". What a chapter calls a
 * tier at all is its `tier` vocabulary term.
 */
export interface RoleTier {
  id: string;
  chapter_id: string;
  /** Order within the chapter; 1 is highest. */
  position: number;
  name: string;
  /** What every role in the tier gets, before the role's own overrides. */
  permissions: string[];
  created_at: string;
  updated_at: string;
}
