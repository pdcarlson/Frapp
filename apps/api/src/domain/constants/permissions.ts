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
} as const;

export type SystemPermission =
  (typeof SystemPermissions)[keyof typeof SystemPermissions];

/**
 * Name of the seeded Alumni system role.
 *
 * Alumni are a read-mostly lifecycle state rather than a permission level, so
 * the restrictions the spec places on them (no points, no event check-in, no
 * study hours, no posting outside `#alumni` / DMs) are resolved by role
 * identity rather than by a permission string. See `spec/behavior/alumni.md`.
 *
 * NOTE: system roles can currently be renamed (`RbacService.update` only blocks
 * *deleting* them), so this lookup is by convention. Tracked as a follow-up to
 * give system roles a stable, rename-proof key.
 */
export const ALUMNI_ROLE_NAME = 'Alumni';

export const DEFAULT_SYSTEM_ROLES = [
  {
    name: 'President',
    permissions: [SystemPermissions.WILDCARD],
    is_system: true,
    display_order: 1,
    color: '#FFD700',
  },
  {
    name: 'Treasurer',
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
    permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.BACKWORK_UPLOAD,
    ],
    is_system: true,
    display_order: 6,
    color: null,
  },
  {
    // Uses the shared constant so the seeded name and the lifecycle lookup in
    // `RbacService` can never drift apart — a rename here would otherwise
    // silently disable every Alumni restriction for new chapters.
    name: ALUMNI_ROLE_NAME,
    permissions: [SystemPermissions.MEMBERS_VIEW],
    is_system: true,
    display_order: 7,
    color: '#6B7280',
  },
] as const;

export const DEFAULT_CHANNELS = [
  { name: 'general', type: 'PUBLIC', is_read_only: false },
  { name: 'announcements', type: 'PUBLIC', is_read_only: true },
  // System-write, member-read audit feed. The Chunk 02 audit bridge and the
  // onboarding welcome message post system_audit messages here / to #general.
  { name: 'chapter-audit', type: 'PUBLIC', is_read_only: true },
  { name: 'alumni', type: 'ROLE_GATED', is_read_only: false },
] as const;
