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
 * The nav's Settings row (`nav-config.ts`), the chapter switcher's "Chapter
 * settings" link, the Settings rail and the page's "nothing here for you" state
 * all read this module, so the question "can this viewer open something in
 * Settings?" has one answer. The rules are owned by
 * `spec/behavior/settings/README.md` § Who sees what.
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
 * The chapter setup tabs read or write chapter config, and
 * `GET /chapters/:id/config` is guarded by `chapter-config:view` at class level
 * (`chapter-config.controller.ts`), so even its PATCH needs `view`. A custom
 * role holding `chapter-config:manage` alone can use none of them, and gets no
 * door to them (`spec/behavior/rbac.md`).
 */
const CHAPTER_CONFIG_VIEW = "chapter-config:view";

/**
 * Tabs a holder of something other than `chapter-config:view` can still use.
 * The Roles tab needs no config read (`customization.md` § Roles Tab). The
 * Semester tab's rollover card is gated on `semester:rollover` alone and is
 * the only web surface for a rollover, a grant a custom role can carry on
 * its own.
 */
const TAB_EXTRA_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  roles: ["roles:manage"],
  semester: ["semester:rollover"],
};

/**
 * Holding any one of these means Settings has a tab or a tool for the viewer.
 * The nav's Settings row is gated on the set, and `hasSettingsDestination`
 * then drops the row when the only tools behind it are switched off.
 */
export const SETTINGS_ENTRY_PERMISSIONS: readonly string[] = Array.from(
  new Set([
    CHAPTER_CONFIG_VIEW,
    ...Object.values(TAB_EXTRA_PERMISSIONS).flat(),
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
 * render early is harmless, and hiding one is a visible flash. Every tab reads
 * or writes chapter config and needs `chapter-config:view`, except the ones in
 * `TAB_EXTRA_PERMISSIONS`. Hiding a tab from a viewer who could only have seen
 * it fail to load removes nothing they could use.
 */
export function isSettingsTabVisible(
  tab: string,
  permissions: readonly string[] | null | undefined,
): boolean {
  if (permissions === undefined || permissions === null) return true;
  return canAny(
    [CHAPTER_CONFIG_VIEW, ...(TAB_EXTRA_PERMISSIONS[tab] ?? [])],
    permissions,
  );
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

/**
 * Whether Settings holds anything for this viewer: a tab, or a tool whose
 * module is on. The nav's Settings row and the chapter switcher's "Chapter
 * settings" link both ask this, so neither opens onto an empty page. A
 * treasurer whose only tool is Reports loses the row when the chapter switches
 * Reports off, the same way the Reports row used to hide (#2946).
 *
 * Fails open while permissions are unresolved, like every nav gate.
 */
export function hasSettingsDestination(
  permissions: readonly string[] | null | undefined,
  isModuleEnabled?: (moduleKey: string) => boolean,
): boolean {
  if (permissions === undefined || permissions === null) return true;
  const anyTab = canAny(
    [CHAPTER_CONFIG_VIEW, ...Object.values(TAB_EXTRA_PERMISSIONS).flat()],
    permissions,
  );
  return anyTab || visibleSettingsTools(permissions, isModuleEnabled).length > 0;
}
