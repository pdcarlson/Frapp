export const WILDCARD = '*';

export const SystemPermissions = {
  WILDCARD: '*',

  EVENTS_CREATE: 'events:create',
  EVENTS_UPDATE: 'events:update',
  EVENTS_DELETE: 'events:delete',

  MEMBERS_INVITE: 'members:invite',
  MEMBERS_REMOVE: 'members:remove',
  MEMBERS_VIEW: 'members:view',

  POINTS_ADJUST: 'points:adjust',
  POINTS_VIEW_ALL: 'points:view_all',

  ROLES_MANAGE: 'roles:manage',

  CHANNELS_CREATE: 'channels:create',
  CHANNELS_MANAGE: 'channels:manage',

  ANNOUNCEMENTS_POST: 'announcements:post',

  BILLING_VIEW: 'billing:view',
  BILLING_MANAGE: 'billing:manage',

  BACKWORK_UPLOAD: 'backwork:upload',
  BACKWORK_ADMIN: 'backwork:admin',

  GEOFENCES_MANAGE: 'geofences:manage',

  POLLS_CREATE: 'polls:create',
  POLLS_VIEW_ALL: 'polls:view_all',

  TASKS_MANAGE: 'tasks:manage',

  CHAPTER_DOCS_UPLOAD: 'chapter_docs:upload',
  CHAPTER_DOCS_MANAGE: 'chapter_docs:manage',

  SERVICE_LOG: 'service:log',
  SERVICE_APPROVE: 'service:approve',

  SEMESTER_ROLLOVER: 'semester:rollover',

  REPORTS_EXPORT: 'reports:export',

  CHAPTER_CONFIG_VIEW: 'chapter-config:view',
  CHAPTER_CONFIG_MANAGE: 'chapter-config:manage',

  CHAPTER_DIRECTORY_SEARCH: 'chapter-directory:search',

  // Marks a ROLE_GATED channel as one the Alumni lifecycle may author in. Held
  // by the Alumni role, but the posting gate reads it off the *channel's*
  // `required_permissions` — see `ALUMNI_CHANNEL_PERMISSION` in
  // `@repo/validation`.
  ALUMNI_POST: 'alumni:post',
} as const;

export type SystemPermission =
  (typeof SystemPermissions)[keyof typeof SystemPermissions];

/**
 * Stable, rename-proof identity for the seeded system roles.
 *
 * `roles.name` is a display label chapters may rename at will, so it cannot
 * carry authorization or lifecycle meaning: renaming "Alumni" once silently
 * disabled every Alumni restriction chapter-wide, and reattaching the freed
 * name to another role moved those restrictions onto its holders. Every lookup
 * that asks "is this *the* Alumni/President/Member role?" resolves on
 * `roles.system_key` instead, which is set at seed time and is not writable
 * through the API (`RbacService.create` forces it null; `update` strips it).
 *
 * Custom roles carry `system_key: null`.
 */
export const SystemRoleKeys = {
  PRESIDENT: 'PRESIDENT',
  TREASURER: 'TREASURER',
  VICE_PRESIDENT: 'VICE_PRESIDENT',
  SECRETARY: 'SECRETARY',
  MEMBER: 'MEMBER',
  NEW_MEMBER: 'NEW_MEMBER',
  ALUMNI: 'ALUMNI',
} as const;

export type SystemRoleKey =
  (typeof SystemRoleKeys)[keyof typeof SystemRoleKeys];

/**
 * Seeded *display name* of the Alumni system role.
 *
 * Alumni are a read-mostly lifecycle state rather than a permission level, so
 * the restrictions the spec places on them (no points, no event check-in, no
 * study hours, no posting outside `#alumni` / DMs) are resolved by role
 * identity rather than by a permission string. See `spec/behavior/alumni.md`.
 *
 * This is the name the role is *created* with only. Do not resolve the Alumni
 * role by it — use {@link SystemRoleKeys.ALUMNI} against `roles.system_key`,
 * which survives a rename.
 */
export const ALUMNI_ROLE_NAME = 'Alumni';

export const DEFAULT_SYSTEM_ROLES = [
  {
    name: 'President',
    system_key: SystemRoleKeys.PRESIDENT,
    permissions: [SystemPermissions.WILDCARD],
    is_system: true,
    display_order: 1,
    color: '#FFD700',
  },
  {
    name: 'Treasurer',
    system_key: SystemRoleKeys.TREASURER,
    permissions: [
      SystemPermissions.BILLING_VIEW,
      SystemPermissions.BILLING_MANAGE,
      SystemPermissions.POINTS_ADJUST,
      SystemPermissions.POINTS_VIEW_ALL,
      SystemPermissions.POLLS_VIEW_ALL,
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.REPORTS_EXPORT,
      SystemPermissions.EVENTS_CREATE,
      SystemPermissions.EVENTS_UPDATE,
    ],
    is_system: true,
    display_order: 2,
    color: '#10B981',
  },
  {
    name: 'Vice President',
    system_key: SystemRoleKeys.VICE_PRESIDENT,
    permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.POLLS_VIEW_ALL,
    ],
    is_system: true,
    display_order: 3,
    color: null,
  },
  {
    name: 'Secretary',
    system_key: SystemRoleKeys.SECRETARY,
    permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.POLLS_VIEW_ALL,
    ],
    is_system: true,
    display_order: 4,
    color: null,
  },
  {
    name: 'Member',
    system_key: SystemRoleKeys.MEMBER,
    permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.BACKWORK_UPLOAD,
      SystemPermissions.SERVICE_LOG,
      SystemPermissions.POLLS_CREATE,
    ],
    is_system: true,
    display_order: 5,
    color: null,
  },
  {
    name: 'New Member',
    system_key: SystemRoleKeys.NEW_MEMBER,
    permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.BACKWORK_UPLOAD,
    ],
    is_system: true,
    display_order: 6,
    color: null,
  },
  {
    // Display name only. The lifecycle lookup in `RbacService` keys on
    // `system_key` below, so renaming this role — here or by a chapter through
    // the API — no longer affects which members the Alumni restrictions apply
    // to.
    name: ALUMNI_ROLE_NAME,
    system_key: SystemRoleKeys.ALUMNI,
    permissions: [SystemPermissions.MEMBERS_VIEW, SystemPermissions.ALUMNI_POST],
    is_system: true,
    display_order: 7,
    color: '#6B7280',
  },
] as const;

/**
 * Channels seeded on chapter creation.
 *
 * `required_permissions` is persisted verbatim by `ChapterService.create`. It
 * is meaningful only for ROLE_GATED channels — `canAccessChannel` denies a
 * ROLE_GATED channel whose requirement list is empty, so every ROLE_GATED entry
 * here MUST carry a non-empty list or the seeded channel is unreachable.
 *
 * `#alumni` requires `members:view` (held by every seeded role, so active
 * members and alumni both keep the read access `spec/behavior/alumni.md`
 * specifies) plus `alumni:post`, which is what marks it alumni-writable.
 */
export const DEFAULT_CHANNELS = [
  { name: 'general', type: 'PUBLIC', is_read_only: false, required_permissions: null },
  { name: 'announcements', type: 'PUBLIC', is_read_only: true, required_permissions: null },
  // System-write, member-read audit feed. The Chunk 02 audit bridge and the
  // onboarding welcome message post system_audit messages here / to #general.
  { name: 'chapter-audit', type: 'PUBLIC', is_read_only: true, required_permissions: null },
  {
    name: 'alumni',
    type: 'ROLE_GATED',
    is_read_only: false,
    required_permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.ALUMNI_POST,
    ],
  },
] as const;
