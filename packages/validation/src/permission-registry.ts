/**
 * The permission registry: what each system permission is called, what it
 * lets a role do, and which module it belongs to (#4069).
 *
 * **The one source for those words.** The API serves it at
 * `GET /v1/roles/permissions-catalog`; web and mobile read it from here, so a
 * permission reads the same on every surface. The permission strings
 * themselves are still enforced by the API's guards
 * (`SystemPermissions` in `apps/api/src/domain/constants/permissions.ts`),
 * and `permissions.registry.spec.ts` there fails when the two lists differ.
 *
 * `module` is a `MODULE_CATALOG` key (`@repo/org-archetypes`), or `chapter`
 * for a permission that belongs to the chapter rather than to one module. The
 * same API spec pins that.
 *
 * `scope` is `chapter` for every entry today. It exists so a level above the
 * chapter can later add its own keys to this list without a second catalog;
 * nothing reads it yet.
 */

export type PermissionScope = "chapter";

/**
 * The groups permissions are shown under, in display order. `label` is the
 * product's name for the group, which is not always the module's own
 * (`geofences` is "Study zones" wherever a member reads it).
 */
export const PERMISSION_MODULES = [
  { key: "chapter", label: "Chapter" },
  { key: "members", label: "Members" },
  { key: "chat", label: "Chat" },
  { key: "announcements", label: "Announcements" },
  { key: "events", label: "Events" },
  { key: "tasks", label: "Tasks" },
  { key: "meetings", label: "Meetings" },
  { key: "points", label: "Points" },
  { key: "hours", label: "Service hours" },
  { key: "polls", label: "Polls" },
  { key: "rush", label: "Recruitment" },
  { key: "backwork", label: "Backwork" },
  { key: "documents", label: "Documents" },
  { key: "geofences", label: "Study zones" },
  { key: "reports", label: "Reports" },
  { key: "billing", label: "Billing" },
] as const;

export type PermissionModuleKey = (typeof PERMISSION_MODULES)[number]["key"];

export interface PermissionDefinition {
  /** The stored string, e.g. `events:create`. Never renamed: roles hold it. */
  permission: string;
  module: PermissionModuleKey;
  /** A row label: what the role can do, verb first. */
  label: string;
  /** One line saying what granting it opens. */
  description: string;
  scope: PermissionScope;
}

function chapterPermission(
  permission: string,
  module: PermissionModuleKey,
  label: string,
  description: string,
): PermissionDefinition {
  return { permission, module, label, description, scope: "chapter" };
}

export const PERMISSION_REGISTRY: readonly PermissionDefinition[] = [
  chapterPermission(
    "*",
    "chapter",
    "Everything",
    "Every permission, including ones added later. Only the President holds it.",
  ),
  chapterPermission(
    "roles:manage",
    "chapter",
    "Manage roles",
    "Create, edit and delete roles, give roles to members, and edit pledge classes.",
  ),
  chapterPermission(
    "chapter-config:view",
    "chapter",
    "See chapter settings",
    "Open chapter settings, custom fields and, with the directory, the audit log.",
  ),
  chapterPermission(
    "chapter-config:manage",
    "chapter",
    "Change chapter settings",
    "Change chapter settings, modules, custom fields, and the chapter's name, accent and logo.",
  ),
  chapterPermission(
    "semester:rollover",
    "chapter",
    "Start a new semester",
    "Close the current semester and start the next one.",
  ),
  // AI (ADR-28). The API leaves these two out of the catalog it serves while
  // its AI switch is off, so no role editor offers them on such a server.
  chapterPermission(
    "ai:use",
    "chapter",
    "Use AI",
    "Ask for AI drafts and answers, once the chapter has turned AI on.",
  ),
  chapterPermission(
    "ai:act",
    "chapter",
    "Let AI take actions",
    "Have AI carry out things the member could do themselves, after they confirm each one.",
  ),

  chapterPermission(
    "members:view",
    "members",
    "See the full directory",
    "See every member, and open chat, the roster and events.",
  ),
  chapterPermission(
    "members:invite",
    "members",
    "Invite members",
    "Invite people by email or link, and revoke invites.",
  ),
  chapterPermission(
    "members:remove",
    "members",
    "Remove members",
    "Remove a member from the chapter.",
  ),

  chapterPermission(
    "channels:create",
    "chat",
    "Create channels",
    "Add new chat channels.",
  ),
  chapterPermission(
    "channels:manage",
    "chat",
    "Manage channels and pins",
    "Edit and delete channels, pin messages, close anyone's poll, and set who can use a channel.",
  ),
  chapterPermission(
    "alumni:post",
    "chat",
    "Post in the alumni channel",
    "No longer used. Who can post in a channel is set in that channel's settings.",
  ),

  chapterPermission(
    "announcements:post",
    "announcements",
    "Post announcements",
    "No longer used. Who can post in a channel is set in that channel's settings.",
  ),

  chapterPermission(
    "events:create",
    "events",
    "Create events",
    "Add events to the chapter calendar.",
  ),
  chapterPermission(
    "events:update",
    "events",
    "Edit events",
    "Change an event's details and take attendance.",
  ),
  chapterPermission(
    "events:delete",
    "events",
    "Delete events",
    "Delete an event from the calendar.",
  ),

  chapterPermission(
    "tasks:manage",
    "tasks",
    "Manage tasks",
    "Create and assign tasks, and confirm them done.",
  ),

  chapterPermission(
    "meetings:record",
    "meetings",
    "Write meeting minutes",
    "Start minutes for a meeting, and edit and post the ones they started.",
  ),
  chapterPermission(
    "meetings:edit",
    "meetings",
    "Edit anyone's minutes",
    "Edit and post minutes another officer started, before or after they are posted.",
  ),
  chapterPermission(
    "meetings:delete",
    "meetings",
    "Delete minutes",
    "Delete a meeting's minutes for good.",
  ),

  chapterPermission(
    "points:adjust",
    "points",
    "Add or remove points",
    "Give or take points from a member by hand.",
  ),
  chapterPermission(
    "points:view_all",
    "points",
    "See every member's points",
    "See every member's point history, not only their own.",
  ),

  chapterPermission(
    "service:log",
    "hours",
    "Log service hours",
    "Submit service hours for approval.",
  ),
  chapterPermission(
    "service:approve",
    "hours",
    "Approve service hours",
    "Approve or reject the service hours members submit.",
  ),

  chapterPermission(
    "polls:create",
    "polls",
    "Create polls",
    "Start a poll in a channel.",
  ),
  chapterPermission(
    "polls:view_all",
    "polls",
    "See every poll",
    "See every poll in the chapter with its vote counts.",
  ),

  chapterPermission(
    "rush:view",
    "rush",
    "See prospects",
    "Look up a prospect and see their bid status.",
  ),
  chapterPermission(
    "rush:add",
    "rush",
    "Add prospects",
    "Add a prospect to the chapter's recruitment list.",
  ),
  chapterPermission(
    "rush:notes",
    "rush",
    "Write notes on prospects",
    "Write notes on a prospect for other members to read.",
  ),
  chapterPermission(
    "rush:vote",
    "rush",
    "Vote on prospects",
    "Cast a vote on a prospect.",
  ),
  chapterPermission(
    "rush:view_results",
    "rush",
    "See vote results",
    "See how many votes a prospect has.",
  ),
  chapterPermission(
    "rush:bid",
    "rush",
    "Record bids",
    "Record that the chapter extended a bid to a prospect.",
  ),
  chapterPermission(
    "rush:manage",
    "rush",
    "Manage recruitment",
    "Delete prospects and export the recruitment list.",
  ),

  chapterPermission(
    "backwork:upload",
    "backwork",
    "Upload backwork",
    "Add study resources to Backwork.",
  ),
  chapterPermission(
    "backwork:admin",
    "backwork",
    "Manage backwork",
    "Manage courses and professors, and delete resources.",
  ),

  chapterPermission(
    "chapter_docs:upload",
    "documents",
    "Upload documents",
    "Add documents to the chapter's files.",
  ),
  chapterPermission(
    "chapter_docs:manage",
    "documents",
    "Manage documents",
    "Organize and delete the chapter's documents.",
  ),

  chapterPermission(
    "geofences:manage",
    "geofences",
    "Manage study zones",
    "Create, edit and delete the places study hours count.",
  ),

  chapterPermission(
    "reports:export",
    "reports",
    "Export reports",
    "Export attendance, points and roster reports.",
  ),

  chapterPermission(
    "billing:view",
    "billing",
    "See billing",
    "See the chapter's plan and every member's invoices.",
  ),
  chapterPermission(
    "billing:manage",
    "billing",
    "Manage billing and invoices",
    "Change the chapter's plan and create member invoices.",
  ),
];

const BY_PERMISSION: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSION_REGISTRY.map((entry) => [entry.permission, entry]),
);

const MODULE_LABELS: ReadonlyMap<string, string> = new Map(
  PERMISSION_MODULES.map((module) => [module.key, module.label]),
);

/**
 * The recruitment permissions a role needs to do what any member could do
 * before recruitment had permissions of its own (#4070): look a prospect up,
 * add one, write notes, vote, see the count and record a bid. The seeded
 * Member role holds them, and migration
 * `20261111010000_rush_permissions_backfill.sql` carries the same six for
 * existing roles. `rush:manage` is left out: nobody could delete or export.
 */
export const RUSH_MEMBER_PERMISSIONS = [
  "rush:view",
  "rush:add",
  "rush:notes",
  "rush:vote",
  "rush:view_results",
  "rush:bid",
] as const;

/** The registry entry for a permission string, if it is a system one. */
export function permissionDefinition(
  permission: string,
): PermissionDefinition | undefined {
  return BY_PERMISSION.get(permission);
}

/** The display name of a registry module key. */
export function permissionModuleLabel(module: PermissionModuleKey): string {
  return MODULE_LABELS.get(module) ?? module;
}

function words(text: string): string {
  return text.replace(/[-_]/g, " ").trim();
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * What a permission lets a role do, in words a chapter president reads.
 *
 * A permission the registry doesn't know (a chapter's custom string) reads
 * from its own string instead, `"fines:waive"` as "Waive fines", so a row is
 * never blank or a constant. A third segment qualifies the subject: a Discord
 * import's per-role read gate `"channels:read:exec-board"` reads "Read exec
 * board channels".
 */
export function permissionLabel(permission: string): string {
  const known = BY_PERMISSION.get(permission);
  if (known) return known.label;
  if (!permission.includes(":")) return sentenceCase(words(permission));
  const [subjectPart = "", actionPart = "", ...qualifier] =
    permission.split(":");
  const subject = words(subjectPart);
  const action = words(actionPart);
  if (!action) return sentenceCase(subject);
  const object = [words(qualifier.join(" ")), subject]
    .filter(Boolean)
    .join(" ");
  return `${sentenceCase(action)} ${object}`;
}

export interface PermissionGroup<T> {
  label: string;
  entries: T[];
}

/**
 * Groups permission rows by registry module, in `PERMISSION_MODULES` order,
 * keeping the given order within a group. The wildcard is dropped: it is not a
 * permission anyone toggles. A string the registry doesn't know groups under
 * its own namespace (`fines:waive` under "Fines"), after the known groups; one
 * with no namespace lands under "Chapter".
 */
export function groupPermissionsByModule<T extends { permission: string }>(
  rows: readonly T[],
): PermissionGroup<T>[] {
  const known = new Map<string, T[]>();
  const customOrder: string[] = [];
  const custom = new Map<string, T[]>();
  const chapterLabel = permissionModuleLabel("chapter");

  for (const row of rows) {
    if (row.permission === "*") continue;
    const definition = BY_PERMISSION.get(row.permission);
    const namespace = row.permission.includes(":")
      ? row.permission.slice(0, row.permission.indexOf(":"))
      : "";
    const label = definition
      ? permissionModuleLabel(definition.module)
      : namespace
        ? sentenceCase(words(namespace))
        : chapterLabel;
    const isKnownGroup = PERMISSION_MODULES.some(
      (module) => module.label === label,
    );
    const bucket = isKnownGroup ? known : custom;
    if (!bucket.has(label)) {
      bucket.set(label, []);
      if (!isKnownGroup) customOrder.push(label);
    }
    bucket.get(label)!.push(row);
  }

  return [
    ...PERMISSION_MODULES.filter((module) => known.has(module.label)).map(
      (module) => ({ label: module.label, entries: known.get(module.label)! }),
    ),
    ...customOrder.map((label) => ({ label, entries: custom.get(label)! })),
  ];
}
