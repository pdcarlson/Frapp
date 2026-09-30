import { can, canAny } from "@repo/validation";

/**
 * Who Settings is for, and what each viewer finds in it.
 *
 * Settings is the one door to officer setup and officer tools (#2946). The
 * sidebar used to carry a six-row Admin group (Roles, Study Zones, Reports,
 * Chat Admin, Discord Import, Settings). That group is what pushed an admin's
 * nav past a 768px window, so it folded into a single Settings row. Roles was
 * already a Settings tab. The other four keep their own full-width pages and
 * are listed in the Settings rail as **tools**.
 *
 * The nav's Settings row (`nav-config.ts`), the Settings rail and the page's
 * "nothing here for you" state all read this module, so the question "can this
 * viewer open something in Settings?" has one answer.
 */

/** Officer pages that live behind Settings but keep their own routes. */
export type SettingsTool = {
  id: string;
  label: string;
  /** Shown where a viewer's Settings holds tools and no setup tabs. */
  description: string;
  href: string;
  permission: string;
  /** `enabled_modules` key; the tool hides when the chapter switches it off. */
  module?: string;
};

export const SETTINGS_TOOLS: readonly SettingsTool[] = [
  {
    id: "chat-admin",
    label: "Chat admin",
    description:
      "Create, edit and delete channels, manage categories and pins, and work the report queue.",
    href: "/chat-admin",
    permission: "channels:manage",
  },
  {
    // `channels:manage`, like Chat admin: an import creates channels, writes
    // history into them, and can delete all of it again.
    id: "discord-import",
    label: "Discord import",
    description: "Bring a Discord server's history in as a read-only archive.",
    href: "/discord-import",
    permission: "channels:manage",
  },
  {
    id: "study-zones",
    label: "Study zones",
    description: "Draw study areas and set their reward rates.",
    href: "/geofences",
    permission: "geofences:manage",
    module: "geofences",
  },
  {
    id: "reports",
    label: "Reports",
    description: "Export attendance, points, roster and service data.",
    href: "/reports",
    permission: "reports:export",
    module: "reports",
  },
];

/**
 * The chapter setup tabs read or write chapter config. `GET /chapters/:id/config`
 * needs `chapter-config:view`; a custom role can be minted with `manage` alone,
 * and such a holder keeps the tabs they had before (#2946 changes who reaches
 * Settings, not what a configurer sees there).
 */
const CHAPTER_SETUP_PERMISSIONS = [
  "chapter-config:view",
  "chapter-config:manage",
] as const;

/**
 * The Roles tab needs no config read (`customization.md` § Roles Tab), so a
 * `roles:manage` holder without `chapter-config:view` still gets it.
 */
const ROLES_TAB_PERMISSIONS = ["roles:manage", ...CHAPTER_SETUP_PERMISSIONS] as const;

/**
 * Holding any one of these means Settings has something to show the viewer,
 * so the nav's Settings row is gated on the set.
 */
export const SETTINGS_ENTRY_PERMISSIONS: readonly string[] = Array.from(
  new Set([
    ...ROLES_TAB_PERMISSIONS,
    ...SETTINGS_TOOLS.map((tool) => tool.permission),
  ]),
);

/** Every route that sits under the nav's Settings row. */
export const SETTINGS_TOOL_ROUTES: readonly string[] = SETTINGS_TOOLS.map(
  (tool) => tool.href,
);

/**
 * Whether a Settings tab shows for this viewer.
 *
 * Fails open while `permissions` is unresolved, like the nav: showing a tab one
 * render early is harmless, and hiding one is a visible flash. Every tab but
 * Roles reads chapter config or edits it, so it needs a `chapter-config`
 * permission. Before #2946 the nav's only door into Settings was gated on
 * `chapter-config:view`, so hiding these tabs from a viewer holding neither
 * removes nothing the nav could take them to.
 */
export function isSettingsTabVisible(
  tab: string,
  permissions: readonly string[] | null | undefined,
): boolean {
  if (permissions === undefined || permissions === null) return true;
  if (tab === "roles") return canAny(ROLES_TAB_PERMISSIONS, permissions);
  return canAny(CHAPTER_SETUP_PERMISSIONS, permissions);
}

/**
 * The tools this viewer holds, in rail order. Module gating follows the nav:
 * `isModuleEnabled` undefined means "not resolved yet, do not gate".
 */
export function visibleSettingsTools(
  permissions: readonly string[] | null | undefined,
  isModuleEnabled?: (moduleKey: string) => boolean,
): SettingsTool[] {
  return SETTINGS_TOOLS.filter((tool) => {
    if (permissions !== undefined && permissions !== null) {
      if (!can(tool.permission, permissions)) return false;
    }
    if (tool.module && isModuleEnabled && !isModuleEnabled(tool.module)) {
      return false;
    }
    return true;
  });
}
