import {
  ALUMNI_CHANNEL_PERMISSION,
  roleColor,
  RUSH_MEMBER_PERMISSIONS,
  type PermissionDefinition,
} from '@repo/validation';
import { ANNOUNCEMENTS_POST_PERMISSION } from '../utils/channel-access';

export const WILDCARD = '*';

/**
 * The permission strings the API's guards enforce. What each one is called,
 * what it opens and which module it belongs to live in `PERMISSION_REGISTRY`
 * (`@repo/validation`), which web and mobile read too; `permissions.spec.ts`
 * fails when an entry is in one list and not the other.
 */
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

  // The posting gate on read-only channels is `canAccessChannel`
  // (`domain/utils/channel-access.ts`), which owns the value; this entry puts
  // it in the catalog.
  ANNOUNCEMENTS_POST: ANNOUNCEMENTS_POST_PERMISSION,

  BILLING_VIEW: 'billing:view',
  BILLING_MANAGE: 'billing:manage',

  BACKWORK_UPLOAD: 'backwork:upload',
  BACKWORK_ADMIN: 'backwork:admin',

  GEOFENCES_MANAGE: 'geofences:manage',

  POLLS_CREATE: 'polls:create',
  POLLS_VIEW_ALL: 'polls:view_all',

  TASKS_MANAGE: 'tasks:manage',

  // Recruitment (#4070). `RUSH_NOTES`, `RUSH_VIEW_RESULTS` and `RUSH_MANAGE`
  // gate no route yet: notes, delete and export are not built, and the vote
  // count still travels with the prospect (#4084).
  RUSH_VIEW: 'rush:view',
  RUSH_ADD: 'rush:add',
  RUSH_NOTES: 'rush:notes',
  RUSH_VOTE: 'rush:vote',
  RUSH_VIEW_RESULTS: 'rush:view_results',
  RUSH_BID: 'rush:bid',
  RUSH_MANAGE: 'rush:manage',

  CHAPTER_DOCS_UPLOAD: 'chapter_docs:upload',
  CHAPTER_DOCS_MANAGE: 'chapter_docs:manage',

  SERVICE_LOG: 'service:log',
  SERVICE_APPROVE: 'service:approve',

  SEMESTER_ROLLOVER: 'semester:rollover',

  REPORTS_EXPORT: 'reports:export',

  CHAPTER_CONFIG_VIEW: 'chapter-config:view',
  CHAPTER_CONFIG_MANAGE: 'chapter-config:manage',

  // Marks a ROLE_GATED channel as one the Alumni lifecycle may author in. Held
  // by the Alumni role, but the posting gate reads it off the *channel's*
  // `required_permissions` — see `ALUMNI_CHANNEL_PERMISSION` in
  // `@repo/validation`, which owns the value.
  ALUMNI_POST: ALUMNI_CHANNEL_PERMISSION,
} as const;

/** One row of `GET /v1/roles/permissions-catalog`. */
export interface PermissionCatalogEntry extends PermissionDefinition {
  /** The `SystemPermissions` constant's name, e.g. `EVENTS_CREATE`. */
  key: string;
  module_label: string;
}

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

/**
 * The tiers a new chapter starts with, highest first (#4068 decision 10), and
 * what each gives its roles. **Seed data only.** From the moment a chapter
 * exists its tiers are its own rows in `role_tiers`: it can rename, reorder,
 * add and delete them, so nothing may look a tier up by these names or assume
 * there are four. Alumni, and advisors when a chapter adds them, sit outside
 * the tiers.
 *
 * Each tier starts with what its seeded roles held before tiers existed, so a
 * new chapter's roles can do exactly what they could before. The officer
 * defaults Paul decided on 2026-11-10 (#4068 decision 9) land with the rank
 * rules, in the next slice of #4071: `roles:manage` on a tier is only safe
 * once a holder cannot edit their own tier.
 *
 * Chapters that existed before tiers were placed into the same four names by
 * migration `20261111140000_role_tiers.sql`. Changing this list changes new
 * chapters and nothing else.
 */
export const STARTING_ROLE_TIERS = [
  {
    name: 'Exec board',
    permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.POLLS_VIEW_ALL,
    ],
  },
  {
    name: 'Officers and chairs',
    permissions: [SystemPermissions.MEMBERS_VIEW],
  },
  {
    name: 'Members',
    permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.BACKWORK_UPLOAD,
      SystemPermissions.SERVICE_LOG,
      SystemPermissions.POLLS_CREATE,
      // What any member could do in recruitment before it had permissions
      // (#4070); a chapter tightens it from here.
      ...RUSH_MEMBER_PERMISSIONS,
    ],
  },
  {
    name: 'New members',
    permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.BACKWORK_UPLOAD,
    ],
  },
] as const satisfies readonly {
  name: string;
  permissions: readonly string[];
}[];

/**
 * The seeded roles as authored: each role's starting tier (an index into
 * {@link STARTING_ROLE_TIERS}, or `null` for outside the tiers) and what it
 * holds beyond that tier, which is seeded as "on" overrides.
 * {@link DEFAULT_SYSTEM_ROLES} adds the resulting `permissions` list.
 */
const SEEDED_ROLES = [
  {
    name: 'President',
    system_key: SystemRoleKeys.PRESIDENT,
    starting_tier: 0,
    extra_permissions: [SystemPermissions.WILDCARD],
    is_system: true,
    display_order: 1,
    color: roleColor('orange'),
  },
  {
    name: 'Treasurer',
    system_key: SystemRoleKeys.TREASURER,
    starting_tier: 0,
    extra_permissions: [
      SystemPermissions.BILLING_VIEW,
      SystemPermissions.BILLING_MANAGE,
      SystemPermissions.POINTS_ADJUST,
      SystemPermissions.POINTS_VIEW_ALL,
      SystemPermissions.REPORTS_EXPORT,
      SystemPermissions.EVENTS_CREATE,
      SystemPermissions.EVENTS_UPDATE,
    ],
    is_system: true,
    display_order: 2,
    color: roleColor('green'),
  },
  {
    name: 'Vice President',
    system_key: SystemRoleKeys.VICE_PRESIDENT,
    starting_tier: 0,
    extra_permissions: [],
    is_system: true,
    display_order: 3,
    color: roleColor('periwinkle'),
  },
  {
    name: 'Secretary',
    system_key: SystemRoleKeys.SECRETARY,
    starting_tier: 0,
    extra_permissions: [],
    is_system: true,
    display_order: 4,
    color: roleColor('rose'),
  },
  {
    name: 'Member',
    system_key: SystemRoleKeys.MEMBER,
    starting_tier: 2,
    extra_permissions: [],
    is_system: true,
    display_order: 5,
    color: null,
  },
  {
    name: 'New Member',
    system_key: SystemRoleKeys.NEW_MEMBER,
    starting_tier: 3,
    extra_permissions: [],
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
    starting_tier: null,
    extra_permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.ALUMNI_POST,
    ],
    is_system: true,
    display_order: 7,
    color: roleColor('slate'),
  },
] as const satisfies readonly {
  starting_tier: number | null;
  extra_permissions: readonly string[];
  [key: string]: unknown;
}[];

/**
 * Seeded on chapter creation, each into its starting tier
 * ({@link STARTING_ROLE_TIERS}). `permissions` is what the role ends up
 * holding: its tier's list plus its own `extra_permissions`, the same rule the
 * database applies on every later save (`role_effective_permissions`).
 *
 * Colors come from the role palette in `@repo/validation` (#3485): the five
 * officer and Alumni roles get one, while Member and New Member stay uncolored
 * so most of a chapter's chat reads in the plain foreground and the officers
 * stand out. Migration `20261105200000_role_color_palette_defaults.sql` moves
 * existing chapters' untouched seeds onto the same values.
 */
export const DEFAULT_SYSTEM_ROLES = SEEDED_ROLES.map((role) => ({
  ...role,
  permissions: [
    ...new Set<string>([
      ...(role.starting_tier === null
        ? []
        : STARTING_ROLE_TIERS[role.starting_tier].permissions),
      ...role.extra_permissions,
    ]),
  ],
}));

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
 *
 * `description` is the line the channel header shows beside the name and the
 * channel start repeats ("Welcome to #general"). Officers edit it in Chat
 * admin. Migration `20261105210000_default_channel_descriptions.sql` wrote the
 * same four lines into chapters created before they were seeded. Changing one
 * here only reaches new chapters: to change existing ones, add a new forward
 * migration (never edit the shipped one), and update the Channel header row in
 * `spec/ui/design-system/writing.md`.
 */
export const DEFAULT_CHANNELS = [
  {
    name: 'general',
    description: "The whole chapter. Plans, questions, whatever's going on.",
    type: 'PUBLIC',
    is_read_only: false,
    required_permissions: null,
  },
  {
    name: 'announcements',
    description: 'News from officers. Everyone gets notified.',
    type: 'PUBLIC',
    is_read_only: true,
    required_permissions: null,
  },
  // System-write, member-read audit feed. The Chunk 02 audit bridge and the
  // onboarding welcome message post system_audit messages here / to #general.
  {
    name: 'chapter-audit',
    description:
      'Officer changes to dues, roles and settings, posted automatically.',
    type: 'PUBLIC',
    is_read_only: true,
    // System-write only (#3909): no member posts here, whatever their
    // permissions, and the audit mirror finds the channel by this flag.
    is_audit_log: true,
    required_permissions: null,
  },
  {
    name: 'alumni',
    description: 'Alumni and actives keeping in touch.',
    type: 'ROLE_GATED',
    is_read_only: false,
    required_permissions: [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.ALUMNI_POST,
    ],
  },
] as const;
