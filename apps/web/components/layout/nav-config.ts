import {
  BookOpen,
  Calendar as CalendarIcon,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  MapPin,
  MessagesSquare,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  Vote,
} from "lucide-react";

/**
 * Permission-aware dashboard navigation.
 *
 * Kept in a single module so the sidebar, mobile sheet, command palette, and
 * breadcrumb title map all stay in sync. Each entry mirrors the 16-screen
 * layout in `spec/ui-web-dashboard.md` §2 plus member-only surfaces.
 *
 * Permission semantics:
 * - `requirePermission` — a single permission string; hide when absent.
 * - `requireAnyOf` — shown when the caller holds at least one listed.
 * - Omitting both renders the item unconditionally (home, chat, points, etc.
 *   are available to every authenticated member).
 *
 * Status flags:
 * - `status: 'available'` — route is built and clickable.
 * - `status: 'coming-soon'` — disabled with a chip so users can see what's
 *   on the roadmap but not be frustrated by broken links.
 */

export type NavPermissionRule =
  | { requirePermission?: undefined; requireAnyOf?: undefined }
  | { requirePermission: string; requireAnyOf?: undefined }
  | { requirePermission?: undefined; requireAnyOf: readonly string[] };

export type NavStatus = "available" | "coming-soon";

export type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  breadcrumbTitle?: string;
  primaryActionLabel?: string;
  description?: string;
  status: NavStatus;
  statusLabel?: string;
} & NavPermissionRule;

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

export const DASHBOARD_NAV: NavSection[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      {
        id: "home",
        label: "Home",
        icon: LayoutDashboard,
        href: "/home",
        breadcrumbTitle: "Chapter Operations",
        description: "Activity feed, stat cards, and quick actions.",
        status: "available",
      },
      {
        id: "profile",
        label: "Profile",
        icon: Sparkles,
        href: "/profile",
        breadcrumbTitle: "My Profile",
        description: "Name, photo, bio, quiet hours, theme, session.",
        status: "available",
      },
    ],
  },
  {
    id: "people",
    label: "People",
    items: [
      {
        id: "members",
        label: "Members",
        icon: Users,
        href: "/members",
        breadcrumbTitle: "Members",
        primaryActionLabel: "Invite Member",
        description: "Directory, profile cards, invites, deactivation.",
        status: "available",
        requirePermission: "members:view",
      },
      {
        id: "alumni",
        label: "Alumni",
        icon: GraduationCap,
        href: "/alumni",
        breadcrumbTitle: "Alumni",
        description: "Searchable alumni directory with filters.",
        status: "available",
        requirePermission: "members:view",
      },
      {
        id: "roles",
        label: "Roles",
        icon: ShieldCheck,
        href: "/roles",
        breadcrumbTitle: "Roles & Permissions",
        primaryActionLabel: "New Role",
        description: "Custom roles, permission catalog, presidency transfer.",
        status: "available",
        requirePermission: "roles:manage",
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      {
        id: "events",
        label: "Events",
        icon: CalendarIcon,
        href: "/events",
        breadcrumbTitle: "Events",
        primaryActionLabel: "New Event",
        description: "Schedule, attendance, check-ins, calendar export.",
        status: "available",
      },
      {
        id: "points",
        label: "Points",
        icon: Star,
        href: "/points",
        breadcrumbTitle: "Points Ledger",
        primaryActionLabel: "Adjust Points",
        description: "Leaderboard, transactions, anomaly audit.",
        status: "available",
      },
      {
        id: "tasks",
        label: "Tasks",
        icon: ClipboardCheck,
        href: "/tasks",
        breadcrumbTitle: "Tasks",
        primaryActionLabel: "New Task",
        description: "Assign, track, and confirm chapter tasks.",
        status: "available",
      },
      {
        id: "service",
        label: "Service Hours",
        icon: FileText,
        href: "/service",
        breadcrumbTitle: "Service Hours",
        primaryActionLabel: "Log service",
        description: "Log service hours and approve entries for points.",
        status: "available",
      },
    ],
  },
  {
    id: "communications",
    label: "Communications",
    items: [
      {
        id: "chat",
        label: "Chat",
        icon: MessagesSquare,
        breadcrumbTitle: "Chat",
        primaryActionLabel: "New Channel",
        description: "Channels, DMs, announcements, realtime.",
        status: "coming-soon",
        statusLabel: "Soon",
      },
      {
        id: "polls",
        label: "Polls",
        icon: Vote,
        breadcrumbTitle: "Polls",
        primaryActionLabel: "New Poll",
        description: "Create polls and view live results.",
        status: "coming-soon",
        statusLabel: "Soon",
        requireAnyOf: ["polls:create", "channels:manage"],
      },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    items: [
      {
        id: "backwork",
        label: "Backwork",
        icon: BookOpen,
        breadcrumbTitle: "Backwork",
        primaryActionLabel: "Upload Resource",
        description: "Academic library with rich filters.",
        status: "coming-soon",
        statusLabel: "Soon",
      },
      {
        id: "documents",
        label: "Documents",
        icon: FolderOpen,
        href: "/documents",
        breadcrumbTitle: "Chapter Documents",
        primaryActionLabel: "Upload Document",
        description: "Chapter files and organizational documents.",
        status: "available",
      },
      {
        id: "geofences",
        label: "Study Zones",
        icon: MapPin,
        breadcrumbTitle: "Study Geofences",
        primaryActionLabel: "Add Geofence",
        description: "Draw study polygons and reward rates.",
        status: "coming-soon",
        statusLabel: "Soon",
        requirePermission: "geofences:manage",
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
        icon: CircleDollarSign,
        href: "/billing",
        breadcrumbTitle: "Billing",
        primaryActionLabel: "Create Invoice",
        description: "Subscription, Stripe portal, member invoices.",
        status: "available",
        requirePermission: "billing:view",
      },
      {
        id: "reports",
        label: "Reports",
        icon: FileText,
        breadcrumbTitle: "Reports & Export",
        primaryActionLabel: "Export Report",
        description: "Attendance, points, roster, and service exports.",
        status: "coming-soon",
        statusLabel: "Soon",
        requirePermission: "reports:export",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      {
        id: "settings",
        label: "Settings",
        icon: Settings,
        href: "/settings",
        breadcrumbTitle: "Chapter Settings",
        description: "Chapter profile, branding, semester, danger zone.",
        status: "available",
      },
    ],
  },
];

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
