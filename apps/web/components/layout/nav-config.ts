import {
  BackworkGlyph,
  BillingGlyph,
  ChatGlyph,
  DirectoryGlyph,
  DocumentsGlyph,
  EventsGlyph,
  PointsGlyph,
  PollsGlyph,
  ServiceGlyph,
  SettingsGlyph,
  StudyGlyph,
  TasksGlyph,
  type NavGlyphComponent,
} from "@/components/layout/nav-glyphs";
import {
  SETTINGS_ENTRY_PERMISSIONS,
  SETTINGS_TOOL_ROUTES,
} from "@/components/settings/settings-access";

/**
 * Permission-aware dashboard navigation.
 *
 * Kept in a single module so the sidebar and the mobile drawer stay in sync.
 * (There is no longer a command palette or a breadcrumb title map; #2141
 * deleted both.) The row-by-row table in `spec/ui/web-dashboard/README.md`
 * § Navigation map mirrors this file, and a change to one changes the other.
 *
 * Structure (#2946): a Chat anchor with no section header, then Chapter, then
 * Resources, then one unlabeled group holding Directory, Billing and Settings.
 * Chat leads because chat is the product's home — `/` and `/dashboard` both
 * redirect there. Profile is deliberately absent: it lives in the account menu,
 * which the shell hangs off the top-bar avatar (`account-menu.tsx`), because it
 * is about the viewer, not about the chapter.
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
 * Status flags:
 * - `status: 'available'` — route is built and clickable.
 * - `status: 'coming-soon'` — disabled with a chip so users can see what's
 *   on the roadmap but not be frustrated by broken links.
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
 * Section gating is derived, never declared: a section renders only when at
 * least one of its items survives both gates (`isNavItemVisible` in
 * `protected-nav-item.tsx`), so a heading never announces an empty group.
 */

export type NavPermissionRule =
  | { requirePermission?: undefined; requireAnyOf?: undefined }
  | { requirePermission: string; requireAnyOf?: undefined }
  | { requirePermission?: undefined; requireAnyOf: readonly string[] };

export type NavStatus = "available" | "coming-soon";

export type NavItem = {
  id: string;
  label: string;
  /** A Signet duotone glyph (`nav-glyphs.tsx`) — the intent → glyph map is `iconography.md` §6.2. */
  icon: NavGlyphComponent;
  href?: string;
  breadcrumbTitle?: string;
  description?: string;
  status: NavStatus;
  statusLabel?: string;
  /** `enabled_modules` key that gates this item; omit for always-on items. */
  module?: string;
  /**
   * Other routes that live under this row. While one of them is open the row
   * reads as the current section (`aria-current="true"`), so a page reached
   * from inside Settings still shows where it sits in the nav.
   */
  activeFor?: readonly string[];
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
        breadcrumbTitle: "Chat",
        description: "Channels, DMs, announcements, realtime.",
        status: "available",
      },
    ],
  },
  {
    id: "chapter",
    label: "Chapter",
    items: [
      {
        id: "events",
        label: "Events",
        icon: EventsGlyph,
        href: "/events",
        breadcrumbTitle: "Events",
        description: "Schedule, attendance, check-ins, calendar export.",
        status: "available",
        module: "events",
      },
      {
        id: "tasks",
        label: "Tasks",
        icon: TasksGlyph,
        href: "/tasks",
        breadcrumbTitle: "Tasks",
        description: "Assign, track, and confirm chapter tasks.",
        status: "available",
        module: "tasks",
      },
      {
        id: "points",
        label: "Points",
        icon: PointsGlyph,
        href: "/points",
        breadcrumbTitle: "Points Ledger",
        description: "Leaderboard, transactions, anomaly audit.",
        status: "available",
        module: "points",
      },
      {
        id: "study",
        label: "Study hours",
        icon: StudyGlyph,
        href: "/study",
        breadcrumbTitle: "Study hours",
        description: "Start a tracked study session inside a study zone.",
        status: "available",
        module: "hours",
      },
      {
        id: "service",
        label: "Service hours",
        icon: ServiceGlyph,
        href: "/service",
        breadcrumbTitle: "Service hours",
        description: "Log service hours and approve entries for points.",
        status: "available",
        module: "hours",
      },
      {
        id: "polls",
        label: "Polls",
        icon: PollsGlyph,
        href: "/polls",
        breadcrumbTitle: "Polls",
        description: "Chapter poll list with live results.",
        status: "available",
        module: "polls",
        requirePermission: "polls:view_all",
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
        breadcrumbTitle: "Chapter Documents",
        description: "Chapter files and organizational documents.",
        status: "available",
        module: "documents",
      },
      {
        id: "backwork",
        label: "Backwork",
        icon: BackworkGlyph,
        href: "/backwork",
        breadcrumbTitle: "Backwork",
        description: "Academic library with rich filters.",
        status: "available",
        module: "backwork",
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
        breadcrumbTitle: "Directory",
        description: "Actives and alumni, profile cards, invites, deactivation.",
        status: "available",
        requirePermission: "members:view",
      },
      {
        id: "billing",
        label: "Billing",
        icon: BillingGlyph,
        href: "/billing",
        breadcrumbTitle: "Billing",
        description: "Subscription, Stripe portal, member invoices, dues.",
        status: "available",
        requirePermission: "billing:view",
      },
      {
        id: "settings",
        label: "Settings",
        icon: SettingsGlyph,
        href: "/settings",
        breadcrumbTitle: "Chapter Settings",
        description:
          "Chapter setup, roles, and officer tools: chat admin, Discord import, study zones, reports.",
        status: "available",
        // Shown to anyone Settings has something for: chapter-config:view
        // (the setup tabs), roles:manage (the Roles tab), or one of the
        // officer tools' permissions. Settings hides whatever else the viewer
        // cannot use (`settings-access.ts`). The fail-fast rule in
        // `spec/ui/design-system/README.md` §5 is why the row is gated at all:
        // an entry point that opens onto nothing is the defect.
        requireAnyOf: SETTINGS_ENTRY_PERMISSIONS,
        activeFor: SETTINGS_TOOL_ROUTES,
      },
    ],
  },
];

/**
 * Titles for routes that are reachable but deliberately absent from the nav.
 *
 * **This no longer feeds the shell.** It existed because the shell derived
 * every page's title from `DASHBOARD_NAV_BY_HREF`, so a route with no nav row
 * fell through to a bare "Dashboard" — which is what `/profile` rendered.
 * #2141 moved titles into the pages themselves (`page-header.tsx`), so a route
 * now names itself and cannot fall through to anything.
 *
 * It is kept as the record of what those off-nav routes are called, so the two
 * places that need the string agree: the page's own `PageHeader`, and the
 * route's `metadata.title`. Adding a row here does NOT make a title appear.
 */
export const OFF_NAV_ROUTE_TITLES: Record<string, string> = {
  "/profile": "My Profile",
};

/** Flattened list of nav items for lookup helpers. */
export const DASHBOARD_NAV_ITEMS: NavItem[] = DASHBOARD_NAV.flatMap(
  (section) => section.items,
);

/**
 * Map of route → nav item. The breadcrumb and header-title resolver that used
 * to read this is gone (#2141); it survives for lookups by href, and
 * `breadcrumbTitle` survives as the canonical display name for a route.
 */
export const DASHBOARD_NAV_BY_HREF: Record<string, NavItem> =
  Object.fromEntries(
    DASHBOARD_NAV_ITEMS.filter((item) => item.href).map((item) => [
      item.href as string,
      item,
    ]),
  );
