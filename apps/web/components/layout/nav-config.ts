import {
  BackworkGlyph,
  BillingGlyph,
  ChatGlyph,
  DirectoryGlyph,
  DocumentsGlyph,
  EventsGlyph,
  ImportGlyph,
  PointsGlyph,
  PollsGlyph,
  ReportsGlyph,
  RolesGlyph,
  ServiceGlyph,
  SettingsGlyph,
  StudyGlyph,
  StudyZonesGlyph,
  TasksGlyph,
  type NavGlyphComponent,
} from "@/components/layout/nav-glyphs";

/**
 * Permission-aware dashboard navigation.
 *
 * Kept in a single module so the sidebar, mobile sheet, command palette, and
 * breadcrumb title map all stay in sync. Each entry mirrors the nav table
 * in `spec/ui/web-dashboard/README.md`.
 *
 * Structure (Wave 0 restructure): a Chat anchor with no section header,
 * followed by five sections. Chat leads because chat is the product's home —
 * `/` and `/dashboard` both redirect there. Profile is deliberately absent:
 * it moved to the account menu at the bottom of the sidebar
 * (`account-menu.tsx`), because it is about the viewer, not about the chapter.
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
 *   is fail-safe: while the chapter config is still loading the item stays
 *   visible.
 *
 * Section gating is derived, never declared: a section renders only when at
 * least one of its items survives both gates (`isNavItemVisible` in
 * `protected-nav-item.tsx`). That is what makes the Admin section role-gated —
 * every item in it carries a permission, so an ordinary member sees neither
 * the rows nor the heading.
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
  primaryActionLabel?: string;
  description?: string;
  status: NavStatus;
  statusLabel?: string;
  /** `enabled_modules` key that gates this item; omit for always-on items. */
  module?: string;
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
        primaryActionLabel: "New Message",
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
        primaryActionLabel: "New Event",
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
        primaryActionLabel: "New Task",
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
        primaryActionLabel: "Adjust Points",
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
        primaryActionLabel: "Start session",
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
        primaryActionLabel: "Log service",
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
        primaryActionLabel: "Open chat",
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
        primaryActionLabel: "Upload Document",
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
        primaryActionLabel: "Upload Resource",
        description: "Academic library with rich filters.",
        status: "available",
        module: "backwork",
      },
    ],
  },
  {
    id: "directory",
    label: "Directory",
    items: [
      {
        id: "members",
        label: "Directory",
        icon: DirectoryGlyph,
        href: "/members",
        breadcrumbTitle: "Directory",
        primaryActionLabel: "Invite Member",
        description: "Actives and alumni, profile cards, invites, deactivation.",
        status: "available",
        requirePermission: "members:view",
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      {
        id: "billing",
        label: "Billing",
        icon: BillingGlyph,
        href: "/billing",
        breadcrumbTitle: "Billing",
        primaryActionLabel: "Create Invoice",
        description: "Subscription, Stripe portal, member invoices, dues.",
        status: "available",
        requirePermission: "billing:view",
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      {
        id: "roles",
        label: "Roles",
        icon: RolesGlyph,
        href: "/settings?tab=roles",
        breadcrumbTitle: "Roles & Permissions",
        description: "Role pack, permission matrix, custom roles, presidency transfer.",
        status: "available",
        requirePermission: "roles:manage",
      },
      {
        id: "geofences",
        label: "Study Zones",
        icon: StudyZonesGlyph,
        href: "/geofences",
        breadcrumbTitle: "Study Zones",
        primaryActionLabel: "Add Study Zone",
        description: "Draw study polygons and reward rates.",
        status: "available",
        module: "geofences",
        requirePermission: "geofences:manage",
      },
      {
        id: "reports",
        label: "Reports",
        icon: ReportsGlyph,
        href: "/reports",
        breadcrumbTitle: "Reports & Export",
        primaryActionLabel: "Generate Report",
        description: "Attendance, points, roster, and service exports.",
        status: "available",
        module: "reports",
        requirePermission: "reports:export",
      },
      {
        id: "discord-import",
        label: "Discord Import",
        icon: ImportGlyph,
        href: "/discord-import",
        breadcrumbTitle: "Discord Import",
        primaryActionLabel: "New import",
        description:
          "Bring a Discord server's history in as a read-only archive.",
        status: "available",
        // `channels:manage` rather than a new permission: an import creates
        // channels, writes history into them, and can delete all of it again —
        // exactly what this permission already authorises.
        requirePermission: "channels:manage",
      },
      {
        id: "settings",
        label: "Settings",
        icon: SettingsGlyph,
        href: "/settings",
        breadcrumbTitle: "Chapter Settings",
        description: "Chapter profile, branding, semester, danger zone.",
        status: "available",
        // The settings screen reads `GET /chapters/:id/config`, which the API
        // guards with this same permission — a member without it would land on
        // a screen that cannot load. Gating the entry point is the fail-fast
        // rule in `spec/ui/design-system/README.md` §5.
        requirePermission: "chapter-config:view",
      },
    ],
  },
];

/**
 * Titles for routes that are reachable but deliberately absent from the nav.
 *
 * The breadcrumb and header title resolve off `DASHBOARD_NAV_BY_HREF`, so a
 * route with no nav entry falls through to the bare "Dashboard". That was
 * harmless while every destination had a sidebar row; moving Profile into the
 * account menu made it a visible defect — `/profile` rendered a page titled
 * "Dashboard".
 *
 * Keep this to routes a member actually lands on. Redirects (`/alumni`,
 * `/roles`) never render a shell of their own and do not belong here.
 */
export const OFF_NAV_ROUTE_TITLES: Record<string, string> = {
  "/profile": "My Profile",
};

/** Flattened list of nav items for lookup helpers. */
export const DASHBOARD_NAV_ITEMS: NavItem[] = DASHBOARD_NAV.flatMap(
  (section) => section.items,
);

/** Map of route → nav item, for breadcrumbs / header title resolution. */
export const DASHBOARD_NAV_BY_HREF: Record<string, NavItem> =
  Object.fromEntries(
    DASHBOARD_NAV_ITEMS.filter((item) => item.href).map((item) => [
      item.href as string,
      item,
    ]),
  );
