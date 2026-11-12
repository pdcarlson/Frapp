import { can, canAny, isBetaOffModule } from "@repo/validation";
import { isModuleSettingsTab } from "@/components/settings/settings-modules";

/**
 * Who Settings is for, and what each viewer finds in it.
 *
 * Settings is the one door to officer setup and officer tools (#2946). The
 * sidebar used to carry a six-row Admin group (Roles, Study Zones, Reports,
 * Chat Admin, Discord Import, Settings). That group is what pushed an admin's
 * nav past a 768px window, so it folded into a single Settings row. Roles was
 * already a Settings tab. The other four keep their own full-width pages, and
 * since #4073 each is opened from its module's page in Chapter settings
 * (`page`), not from a Tools group of the rail.
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
  /** The module page in Chapter settings that lists it (`?tab=`). */
  page: string;
  /**
   * The tool is drawn on its module page itself, not linked from it: `href`
   * is that page. Study zones is the first (Paul, 2026-11-12: opening a tool
   * should not leave Chapter settings); Chat admin, Discord import and
   * Reports still leave it for their own routes.
   */
  embedded?: boolean;
};

export const SETTINGS_TOOLS: readonly SettingsTool[] = [
  {
    id: "chat-admin",
    label: "Chat admin",
    description:
      "Create, edit and delete channels, manage categories and pins, and work the report queue.",
    href: "/chat-admin",
    permission: "channels:manage",
    page: "chat",
  },
  {
    // `channels:manage`, like Chat admin: an import creates channels, writes
    // history into them, and can delete all of it again.
    id: "discord-import",
    label: "Discord import",
    description: "Bring a Discord server's history in as a read-only archive.",
    href: "/discord-import",
    permission: "channels:manage",
    page: "chat",
  },
  {
    id: "study-zones",
    label: "Study zones",
    description: "Draw study areas and set their reward rates.",
    href: "/settings?tab=geofences",
    permission: "geofences:manage",
    page: "geofences",
    module: "geofences",
    embedded: true,
  },
  {
    id: "reports",
    label: "Reports",
    description: "Export attendance, points, roster and service data.",
    href: "/reports",
    permission: "reports:export",
    page: "reports",
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
 * Tabs that read no chapter config at all, so `chapter-config:view` is not a
 * way in. The pledge class tab reads `GET /v1/pledge-classes` and writes with
 * `roles:manage` (`spec/behavior/members.md` § Pledge class and order number);
 * a config viewer without it could change nothing there.
 */
const TAB_ONLY_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  classes: ["roles:manage"],
  /*
   * Plan and billing (#3827) reads `GET /v1/billing/status` and the invoice
   * list, both `billing:view`, and no chapter config. It is the gate the
   * sidebar's Billing row used, so whoever reached billing before still does,
   * and the nav's Chapter settings row now admits a treasurer who holds only
   * this. Plan actions stay behind `billing:manage` inside the section.
   */
  billing: ["billing:view"],
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
    ...Object.values(TAB_ONLY_PERMISSIONS).flat(),
    ...SETTINGS_TOOLS.map((tool) => tool.permission),
  ]),
);

/** Every route of its own that sits under the nav's Settings row. */
export const SETTINGS_TOOL_ROUTES: readonly string[] = SETTINGS_TOOLS.filter(
  (tool) => !tool.embedded,
).map((tool) => tool.href);

/**
 * Whether a Settings tab shows for this viewer.
 *
 * False while `permissions` is unresolved, like the nav (#3854): a tab is drawn
 * only once the viewer's grants are known to include it. Every tab reads
 * or writes chapter config and needs `chapter-config:view`, except the ones in
 * `TAB_EXTRA_PERMISSIONS` (another way in) and `TAB_ONLY_PERMISSIONS` (the
 * only way in). Hiding a tab from a viewer who could only have seen
 * it fail to load removes nothing they could use.
 */
export function isSettingsTabVisible(
  tab: string,
  permissions: readonly string[] | null | undefined,
  isModuleEnabled?: (moduleKey: string) => boolean,
): boolean {
  // A module that is off for every chapter in the beta has no page.
  if (isModuleSettingsTab(tab) && isBetaOffModule(tab)) return false;
  if (permissions === undefined || permissions === null) return false;
  /*
    A module page (#4073) reads chapter config for its switch and rules, so a
    config viewer gets every one. A viewer who holds only a tool, such as a
    treasurer with `reports:export`, gets the page that tool lives on, and
    only while the tool shows: the page is where they reach it now.
  */
  if (isModuleSettingsTab(tab)) {
    return (
      can(CHAPTER_CONFIG_VIEW, permissions) ||
      visibleSettingsTools(permissions, isModuleEnabled).some(
        (tool) => tool.page === tab,
      )
    );
  }
  const only = TAB_ONLY_PERMISSIONS[tab];
  if (only) return canAny(only, permissions);
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
  // None while permissions are unresolved, like the tabs (#3854).
  if (permissions === undefined || permissions === null) return [];
  return SETTINGS_TOOLS.filter((tool) => {
    if (!can(tool.permission, permissions)) return false;
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
 * False while permissions are `undefined` (in flight, or failed online): a
 * door is drawn only once the viewer's grants are known to open it (#3854), as
 * the nav's gated rows wait. True for `null`, a read the offline dashboard
 * cannot run (`useNavPermissions`), where the door shows and the page states
 * the outage.
 */
export function hasSettingsDestination(
  permissions: readonly string[] | null | undefined,
  isModuleEnabled?: (moduleKey: string) => boolean,
): boolean {
  if (permissions === undefined) return false;
  if (permissions === null) return true;
  const anyTab = canAny(
    [
      CHAPTER_CONFIG_VIEW,
      ...Object.values(TAB_EXTRA_PERMISSIONS).flat(),
      ...Object.values(TAB_ONLY_PERMISSIONS).flat(),
    ],
    permissions,
  );
  return (
    anyTab || visibleSettingsTools(permissions, isModuleEnabled).length > 0
  );
}
