import {
  ActivityGlyph,
  BackworkGlyph,
  BillingGlyph,
  ChatGlyph,
  DirectoryGlyph,
  DocumentsGlyph,
  EventsGlyph,
  PointsGlyph,
  ServiceGlyph,
  SettingsGlyph,
  StudyGlyph,
  TasksGlyph,
  type NavGlyphComponent,
} from "@/components/layout/nav-glyphs";
import type { UnsetFeatureKey } from "@repo/hooks";
import { isBetaOffModule } from "@repo/validation";
import {
  SETTINGS_ENTRY_PERMISSIONS,
  SETTINGS_TOOL_ROUTES,
  hasSettingsDestination,
} from "@/components/settings/settings-access";

/**
 * Permission-aware dashboard navigation.
 *
 * Kept in a single module so the sidebar and the mobile drawer stay in sync.
 * It also names the open page: `page-title.ts` reads each row's label as the
 * top bar's title, so the row and the heading cannot disagree. (There is no
 * command palette; #2141 deleted it.) The row-by-row table in `spec/ui/web-dashboard/README.md`
 * § Navigation map mirrors this file, and a change to one changes the other.
 *
 * Structure (#2946): a Chat anchor with no section header, then Chapter, then
 * Resources, then one unlabeled group holding Directory, Billing and Chapter
 * settings. Chat leads because chat is the product's home — `/` and
 * `/dashboard` both redirect there. Profile and the personal Settings page are
 * deliberately absent: they live in the account menu, which the shell hangs
 * off the top-bar avatar (`account-menu.tsx`), because they are about the
 * viewer, not about the chapter. That is the two doors (#3856): the row here
 * is named "Chapter settings" so it cannot be mistaken for the member's own.
 *
 * **The nav fits a 1024×768 window for every seeded role.** A six-row Admin
 * group (Roles, Study Zones, Reports, Chat Admin, Discord Import, Settings)
 * used to close the list. For a President it needed an 828px-tall window and
 * scrolled on a 768px one. It folded into the Settings row: Roles is a Settings
 * tab, and the four officer tools keep their own pages behind the Settings rail
 * (`components/settings/settings-access.ts`). Adding a row costs 36px of that
 * budget, and `tests/visual/nav-fit.spec.ts` fails the build when the nav no
 * longer fits.
 *
 * There is no `primaryActionLabel`. The shell used to render one per route as a
 * header button, but `primaryActionHref` resolved to the route already open, so
 * it was a link to the current page — and every such action is also reachable
 * inside the page. The board deletes it (`1t`, "per-route primaryActionLabel").
 *
 * Permission semantics:
 * - `requirePermission` — a single permission string; hide when absent.
 * - `requireAnyOf` — shown when the caller holds at least one listed.
 * - Omitting both renders the item unconditionally.
 *
 * Every row links to a built route. There are no roadmap rows: a row drawn
 * disabled with nothing behind it is a dead-end control, and the "Coming soon"
 * branch that drew one had no producer left when it was deleted (#3089).
 *
 * Module gating:
 * - `module` — the `enabled_modules` key (see `@repo/org-archetypes`
 *   `MODULE_CATALOG`) that gates this item. When the chapter disables the
 *   module in Settings → Modules, the item is hidden from the sidebar. Items
 *   without a `module` are always-on or governed purely by permission. Hiding
 *   is fail-safe: while the chapter read is still loading the item stays
 *   visible. The shell reads module state from the member-readable current
 *   chapter (`lib/hooks/use-chapter-module-gate.ts`), not the officer-only
 *   config read.
 *
 * Setup gating:
 * - `hiddenUntilSetUp` — a feature that is on but that nobody has set up yet
 *   hides, since its page could only say so (`useHiddenUnsetFeatures` in
 *   `@repo/hooks`; `spec/product/modules.md` § Not-set-up features).
 *   Documents with nothing in it hides from a viewer who can't upload; Study
 *   hours with no active zone hides from everyone, because zones are made in
 *   the Study zones tool, not on its page. Nothing hides while permissions,
 *   modules or the list are still loading, or after the list's read fails.
 *
 * Section gating is derived, never declared: a section renders only when at
 * least one of its items survives every gate (`isNavItemVisible` in
 * `protected-nav-item.tsx`), so a heading never announces an empty group.
 */

export type NavPermissionRule =
  | { requirePermission?: undefined; requireAnyOf?: undefined }
  | { requirePermission: string; requireAnyOf?: undefined }
  | { requirePermission?: undefined; requireAnyOf: readonly string[] };

export type NavItem = {
  id: string;
  label: string;
  /** A Signet duotone glyph (`nav-glyphs.tsx`) — the intent → glyph map is `iconography.md` §6.2. */
  icon: NavGlyphComponent;
  href: string;
  description?: string;
  /** `enabled_modules` key that gates this item; omit for always-on items. */
  module?: string;
  /**
   * Hide from a member until an officer sets the feature up (see "Setup
   * gating" above). Omit for a feature that works with nothing in it.
   */
  hiddenUntilSetUp?: UnsetFeatureKey;
  /**
   * Other routes that live under this row. While one of them is open the row
   * reads as the current section (`aria-current="true"`), so a page reached
   * from inside Settings still shows where it sits in the nav.
   */
  activeFor?: readonly string[];
  /**
   * A last check for a row whose destination depends on more than one
   * permission or module: the row shows only when this returns true. It runs
   * after the permission rule, and only once permissions have resolved, since
   * every nav gate fails open until then (`isNavItemVisible`).
   */
  showWhen?: (
    permissions: readonly string[],
    isModuleEnabled?: (moduleKey: string) => boolean,
  ) => boolean;
} & NavPermissionRule;

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
  /**
   * Anchor sections render their items with no heading. Used for Chat, which
   * is the app's home rather than a member of any group.
   */
  anchor?: boolean;
};

export const DASHBOARD_NAV: NavSection[] = [
  {
    id: "anchor",
    label: "Chat",
    anchor: true,
    items: [
      {
        id: "chat",
        label: "Chat",
        icon: ChatGlyph,
        href: "/chat",
        description: "Channels, DMs, announcements, realtime.",
      },
    ],
  },
  {
    id: "chapter",
    label: "Chapter",
    items: [
      {
        // What is waiting on the viewer and what they made, gathered from
        // the modules below (#3897). It leads the group because it is the
        // inbox for the rest of it. No `module`: the page spans modules, and
        // its read leaves out any that are off. No permission either: the
        // read needs `members:view`, which every member role holds.
        id: "activity",
        label: "Activity",
        icon: ActivityGlyph,
        href: "/activity",
        description: "What needs you, and what you made.",
      },
      {
        id: "events",
        label: "Events",
        icon: EventsGlyph,
        href: "/events",
        description: "Schedule, attendance and check-ins.",
        module: "events",
      },
      {
        id: "tasks",
        label: "Tasks",
        icon: TasksGlyph,
        href: "/tasks",
        description: "Assign, track, and confirm chapter tasks.",
        module: "tasks",
      },
      {
        id: "points",
        label: "Points",
        icon: PointsGlyph,
        href: "/points",
        description: "Leaderboard, transactions, anomaly audit.",
        module: "points",
      },
      {
        id: "study",
        label: "Study hours",
        icon: StudyGlyph,
        href: "/study",
        description: "Start a tracked study session inside a study zone.",
        module: "hours",
        hiddenUntilSetUp: "study",
      },
      {
        id: "service",
        label: "Service hours",
        icon: ServiceGlyph,
        href: "/service",
        description: "Log service hours and approve entries for points.",
        module: "hours",
      },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    items: [
      {
        id: "documents",
        label: "Documents",
        icon: DocumentsGlyph,
        href: "/documents",
        description: "Chapter files and organizational documents.",
        module: "documents",
        hiddenUntilSetUp: "documents",
      },
      {
        id: "backwork",
        label: "Backwork",
        icon: BackworkGlyph,
        href: "/backwork",
        description: "Academic library with rich filters.",
        module: "backwork",
        // The library's read is guarded on either at controller level, so a
        // viewer with neither (Alumni, a Treasurer-only officer) would open
        // a page that can only fail. Members hold `backwork:upload`, and an
        // empty library is theirs to start, so it has no setup gate.
        requireAnyOf: ["backwork:upload", "backwork:admin"],
      },
    ],
  },
  {
    /*
     * Directory, Billing and Settings share one UNLABELED group.
     *
     * Directory and Billing were two sections of one item each, so the
     * headings "DIRECTORY" and "FINANCE" were each announcing a single row
     * whose own label already said the same word. The framework board (option
     * `1b`) merged them and dropped both headings; `1t` lists the two labels as
     * deleted chrome. Settings joined them when the Admin group folded into it
     * (#2946). The group keeps a wider top margin so it still reads as its own
     * block.
     *
     * `anchor` is the existing "render items with no heading" flag, the same
     * one Chat uses. It is not a claim that this group is an app home.
     */
    id: "directory-billing-settings",
    label: "Directory, billing and settings",
    anchor: true,
    items: [
      {
        id: "members",
        label: "Directory",
        icon: DirectoryGlyph,
        href: "/members",
        description:
          "Actives and alumni, profile cards, invites, deactivation.",
        requirePermission: "members:view",
      },
      {
        id: "billing",
        label: "Billing",
        icon: BillingGlyph,
        href: "/billing",
        // Hover text, read once: a beta-off dues has no invoices to name.
        description: isBetaOffModule("dues")
          ? "Subscription and Stripe portal."
          : "Subscription, Stripe portal, member invoices, dues.",
        requirePermission: "billing:view",
      },
      {
        id: "settings",
        label: "Chapter settings",
        icon: SettingsGlyph,
        href: "/settings",
        description:
          "Chapter setup, roles, and officer tools: chat admin, Discord import, study zones, reports.",
        // Shown to anyone Settings has something for: a tab they can use, or
        // an officer tool whose module is on (`settings-access.ts`). The
        // permission set is the coarse gate; `showWhen` drops the row when
        // the only tools behind it are switched off. The fail-fast rule in
        // `spec/ui/design-system/README.md` §5 is why the row is gated at all:
        // an entry point that opens onto nothing is the defect.
        requireAnyOf: SETTINGS_ENTRY_PERMISSIONS,
        showWhen: hasSettingsDestination,
        activeFor: SETTINGS_TOOL_ROUTES,
      },
    ],
  },
];

/** Every nav row, flattened (the plan matrix reads their `module` keys). */
export const DASHBOARD_NAV_ITEMS: NavItem[] = DASHBOARD_NAV.flatMap(
  (section) => section.items,
);
