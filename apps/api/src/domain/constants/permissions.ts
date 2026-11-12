import {
  ALUMNI_CHANNEL_PERMISSION,
  roleColor,
  RUSH_MEMBER_PERMISSIONS,
  type PermissionDefinition,
} from '@repo/validation';

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

  // Gated the read-only post check until #3722; a channel's who can post
  // decides that now, and a chapter's existing posters were carried into
  // those lists. Still in the catalog until the registry drops it (#4286).
  ANNOUNCEMENTS_POST: 'announcements:post',

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

  // Held by the Alumni role. Marked a ROLE_GATED channel alumni could post in
  // until #3722; chat reads the channel's lists now (`isAlumniPostableChannel`).
  // `ALUMNI_CHANNEL_PERMISSION` in `@repo/validation` owns the value.
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
 * What the top two starting tiers give their roles in a new chapter (#4068
 * decision 9). `announcements:post` decides no channel's posters since #3722,
 * but the Discord importer still starts a read-only channel's posters from
 * its holders (#4286), so it keeps officers posting there too.
 */
const OFFICER_DEFAULT_PERMISSIONS = [
  SystemPermissions.SERVICE_APPROVE,
  SystemPermissions.ANNOUNCEMENTS_POST,
  SystemPermissions.TASKS_MANAGE,
  SystemPermissions.CHANNELS_CREATE,
  SystemPermissions.CHANNELS_MANAGE,
] as const;

/**
 * What every member of a new chapter can do, whatever their tier (#3709,
 * Paul 2026-11-07: start from social trust and let chapters tighten it).
 * Each of the top three starting tiers carries it, so an officer invited
 * straight into their own role can do what the members they lead can: before
 * this, a Vice President could not create an event or upload backwork. New
 * members get less ({@link STARTING_ROLE_TIERS}).
 *
 * `events:create` makes an event, not a requirement: making anyone required
 * and attaching points take `events:update` (`EventService.create`).
 */
const MEMBER_DEFAULT_PERMISSIONS = [
  SystemPermissions.MEMBERS_VIEW,
  SystemPermissions.EVENTS_CREATE,
  SystemPermissions.BACKWORK_UPLOAD,
  SystemPermissions.SERVICE_LOG,
  SystemPermissions.POLLS_CREATE,
  // What any member could do in recruitment before it had permissions
  // (#4070); a chapter tightens it from here.
  ...RUSH_MEMBER_PERMISSIONS,
] as const;

/**
 * The tiers a new chapter starts with, highest first (#4068 decision 10), and
 * what each gives its roles. **Seed data only.** From the moment a chapter
 * exists its tiers are its own rows in `role_tiers`: it can rename, reorder,
 * add and delete them, so nothing may look a tier up by these names or assume
 * there are four. Alumni, and advisors when a chapter adds them, sit outside
 * the tiers.
 *
 * The top two carry the officer defaults Paul decided on 2026-11-10 (#4068
 * decision 9): both approve service hours, post announcements, and manage
 * tasks and channels; the top one also manages roles and chapter settings.
 * `roles:manage` on a tier is safe because of the rank rules (#4071): nobody
 * edits a role or tier ranked at or above their own, so the Vice President
 * cannot edit the President's role or the Exec board itself.
 *
 * The top three also carry {@link MEMBER_DEFAULT_PERMISSIONS}, what every
 * member can do (#3709); New members get `members:view` and
 * `backwork:upload` only.
 *
 * Chapters that existed before tiers were placed into the same four names by
 * migration `20261111140000_role_tiers.sql`. Changing this list changes new
 * chapters and nothing else; migration
 * `20261112140000_member_social_trust_defaults.sql` carried #3709's two
 * member keys to existing chapters.
 */
export const STARTING_ROLE_TIERS = [
  {
    name: 'Exec board',
    permissions: [
      ...MEMBER_DEFAULT_PERMISSIONS,
      SystemPermissions.POLLS_VIEW_ALL,
      ...OFFICER_DEFAULT_PERMISSIONS,
      SystemPermissions.ROLES_MANAGE,
      SystemPermissions.CHAPTER_CONFIG_VIEW,
      SystemPermissions.CHAPTER_CONFIG_MANAGE,
    ],
  },
  {
    name: 'Officers and chairs',
    permissions: [
      ...MEMBER_DEFAULT_PERMISSIONS,
      ...OFFICER_DEFAULT_PERMISSIONS,
    ],
  },
  {
    name: 'Members',
    permissions: MEMBER_DEFAULT_PERMISSIONS,
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
 * Who a seeded channel's list names (#3722), resolved against the new
 * chapter's own rows when it is created: `null` is everyone (who can see it,
 * for a post list), `tiers` are positions in {@link STARTING_ROLE_TIERS}
 * (0 is the highest), `alumni` adds the Alumni role. An empty `tiers` with no
 * Alumni is nobody: only the President's `*` passes it.
 */
export type SeededChannelAccess = {
  tiers: readonly number[];
  alumni?: boolean;
} | null;

/**
 * Channels seeded on chapter creation.
 *
 * Who can see and who can post are lists of the new chapter's tiers and roles
 * (#3722), which `ChapterService.create` resolves from the rows it just made
 * and writes with `type` and `is_read_only` to match:
 *
 * - `#announcements`: officers post (the top two starting tiers), everyone
 *   reads. Before #3722 it took `announcements:post`, which no seeded role
 *   held, so only the President could post in a new chapter.
 * - `#chapter-audit`: everyone reads, nobody posts. The audit flag (#3909)
 *   refuses every member's write anyway; the empty list says so in the data.
 * - `#alumni`: every starting tier and the Alumni role read and post, which
 *   is what lets alumni post there (`spec/behavior/alumni.md`).
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
    who_can_see: null,
    who_can_post: null,
  },
  {
    name: 'announcements',
    description: 'News from officers. Everyone gets notified.',
    who_can_see: null,
    who_can_post: { tiers: [0, 1] },
  },
  // System-write, member-read audit feed. The Chunk 02 audit bridge and the
  // onboarding welcome message post system_audit messages here / to #general.
  {
    name: 'chapter-audit',
    description:
      'Officer changes to dues, roles and settings, posted automatically.',
    // System-write only (#3909): no member posts here, whatever their
    // roles, and the audit mirror finds the channel by this flag.
    is_audit_log: true,
    who_can_see: null,
    who_can_post: { tiers: [] },
  },
  {
    name: 'alumni',
    description: 'Alumni and actives keeping in touch.',
    who_can_see: { tiers: [0, 1, 2, 3], alumni: true },
    who_can_post: null,
  },
] as const satisfies readonly {
  name: string;
  description: string;
  is_audit_log?: boolean;
  who_can_see: SeededChannelAccess;
  who_can_post: SeededChannelAccess;
}[];
