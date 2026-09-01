"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Ban, ChevronRight, Clock, ShieldCheck } from "lucide-react";
import {
  useCurrentChapter,
  useMyPermissions,
  useNotifications,
  useOrgConfig,
} from "@repo/hooks";
import {
  CurrentChapterPayloadSchema,
  type CurrentChapterPayload,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SKIP_LINK_CLASSES } from "@/components/ui/focus";
import { DashboardCommandMenu } from "@/components/layout/dashboard-command-menu";
import { DashboardNotificationDrawer } from "@/components/layout/dashboard-notification-drawer";
import { AccountMenu } from "@/components/layout/account-menu";
import { AskPill } from "@/components/layout/ask-pill";
import {
  DASHBOARD_NAV,
  DASHBOARD_NAV_BY_HREF,
  OFF_NAV_ROUTE_TITLES,
  type NavItem,
} from "@/components/layout/nav-config";
import {
  isNavItemVisible,
  ProtectedNavItem,
} from "@/components/layout/protected-nav-item";
import {
  MenuGlyph,
  NotificationsGlyph,
  SearchGlyph,
} from "@/components/layout/nav-glyphs";
import { useChapterTheme } from "@/lib/hooks/use-chapter-theme";
import { ChapterWizardGate } from "@/components/onboarding/chapter-wizard";
import { OnboardingTutorial } from "@/components/onboarding/onboarding-tutorial";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { ChapterLockup } from "@/components/layout/chapter-lockup";
import { ChapterSwitcher } from "@/components/layout/chapter-switcher";
import { BetaBadge, type BetaBadgeStyle } from "@/components/layout/beta-badge";

type DashboardShellProps = {
  children: React.ReactNode;
};

/*
 * BETA badge config. Chunk 8 will replace this hardcoded literal with
 * a read from `chapters.beta_config`; until then every signed-in user
 * sees the sidebar pill regardless of chapter.
 */
const BETA_CONFIG: { enabled: boolean; style: BetaBadgeStyle } = {
  enabled: true,
  style: "sidebar_pill",
};

/*
 * The one focus recipe (foundations.md §10): a 3px spread of the accent ring
 * color at ~25% opacity. `--ring` is engine output (step 8), which clears the
 * 3:1 non-text floor on every shell surface for every seeded chapter — the
 * dark-mode ring failures #1149 measured cannot recur, because nothing
 * bone-validated writes `--ring` any more.
 */
const sidebarFocusRingClassName =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25";
/* Sidebar glyphs are 17px per the sidebar-item spec (components.md §7). */
const navIconClassName = "h-[17px] w-[17px]";
const statusIconClassName = "h-3.5 w-3.5";
const topbarIconClassName = "h-5 w-5";

function subscriptionStatusPresentation(
  status: CurrentChapterPayload["subscription_status"],
): {
  label: string;
  className: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  // Signet semantic chips (foundations.md §5): a ~13% tint of the hue as fill
  // with the hue itself as text — never a solid fill, never decorative. The
  // hues are status statements: active=success, past_due=destructive (money is
  // late), incomplete=warning (pending — the legacy chip borrowed the accent
  // for this, which made a status read as branding), canceled=neutral.
  switch (status) {
    case "active":
      return {
        label: "Subscription active",
        className: "border-success/45 bg-success/[.13] text-success",
        Icon: ShieldCheck,
      };
    case "past_due":
      return {
        label: "Payment past due",
        className: "border-destructive/45 bg-destructive/[.13] text-destructive",
        Icon: AlertCircle,
      };
    case "canceled":
      return {
        label: "Subscription canceled",
        className: "border-border bg-secondary text-muted-foreground",
        Icon: Ban,
      };
    case "incomplete":
      return {
        label: "Subscription incomplete",
        className: "border-warning/45 bg-warning/[.13] text-warning",
        Icon: Clock,
      };
  }
}

function DashboardChapterPanel({ variant }: { variant: "sidebar" | "sheet" }) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data, isPending, isError, isFetching } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });

  const labelMuted = "text-muted";
  const shellClass =
    variant === "sidebar"
      ? "rounded-lg border border-border bg-card p-3"
      : "mt-8 rounded-lg border border-border bg-card p-3";

  if (!activeChapterId) {
    return null;
  }

  if (isPending || (isFetching && data === undefined)) {
    return (
      <div className={shellClass}>
        <p className={cn("text-[10px] uppercase tracking-[0.16em]", labelMuted)}>
          Subscription
        </p>
        <div className="mt-2 h-3 w-3/4 animate-pulse rounded-xs bg-popover" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={shellClass}>
        <p className={cn("text-[10px] uppercase tracking-[0.16em]", labelMuted)}>
          Subscription
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Could not load chapter details.
        </p>
      </div>
    );
  }

  const parsed = CurrentChapterPayloadSchema.safeParse(data);
  if (!parsed.success) {
    return (
      <div className={shellClass}>
        <p className={cn("text-[10px] uppercase tracking-[0.16em]", labelMuted)}>
          Subscription
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Could not load chapter details.
        </p>
      </div>
    );
  }

  /*
   * The "Accent adjusted for contrast safety" notice is gone with the legacy
   * accent resolver (#1157): the Signet engine never substitutes a fallback —
   * every role it emits is AA-guaranteed at generation time for any seed, so
   * there is no adjustment to disclose.
   */
  const payload = parsed.data;
  const sub = subscriptionStatusPresentation(payload.subscription_status);
  const SubIcon = sub.Icon;

  return (
    <div className={shellClass}>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-[11px] font-semibold",
          sub.className,
        )}
      >
        <SubIcon className={statusIconClassName} />
        <span>{sub.label}</span>
      </div>
    </div>
  );
}

function findNavItemByPath(pathname: string): NavItem | undefined {
  if (DASHBOARD_NAV_BY_HREF[pathname]) {
    return DASHBOARD_NAV_BY_HREF[pathname];
  }
  // Nested routes ("/members/123") resolve to the deepest matching nav href.
  return Object.entries(DASHBOARD_NAV_BY_HREF)
    .filter(([href]) => href !== "/" && pathname.startsWith(`${href}/`))
    .sort(([a], [b]) => b.length - a.length)[0]?.[1];
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  // Chapter accent, shell-wide: maps the persisted engine roles onto the
  // semantic tokens signet.css defines. Mounted here (not in ChatProvider)
  // so the sidebar's active-item tint doesn't depend on which route is open.
  useChapterTheme();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data: permissionsPayload } = useMyPermissions({
    enabled: Boolean(activeChapterId),
  });
  const permissions = useMemo(
    () => permissionsPayload?.permissions,
    [permissionsPayload],
  );
  // Module gating for the sidebar: items tied to a disabled module hide once
  // the chapter config resolves (Chunk 06). Undefined while loading → show all.
  const orgConfig = useOrgConfig();
  const isModuleEnabled = orgConfig.data?.isModuleEnabled;
  const { data: notificationsData } = useNotifications();
  const unreadNotifications = useMemo(() => {
    if (!Array.isArray(notificationsData)) return 0;
    return (notificationsData as Array<{ read_at?: string | null }>).filter(
      (n) => !n.read_at,
    ).length;
  }, [notificationsData]);

  const activeItem = findNavItemByPath(pathname);
  // A route can be legitimately absent from the nav — Profile lives in the
  // account menu — and still needs a name in the header.
  const crumbLabel =
    (activeItem ? (activeItem.breadcrumbTitle ?? activeItem.label) : undefined) ??
    OFF_NAV_ROUTE_TITLES[pathname];
  const pageTitle = crumbLabel ?? "Dashboard";
  const primaryActionLabel = activeItem?.primaryActionLabel ?? null;
  const primaryActionHref = activeItem?.href ?? pathname;

  function renderSections(onNavigate?: () => void) {
    return DASHBOARD_NAV.map((section) => {
      // A section heading is a promise that something sits under it. Ask the
      // same gate the items use, so a section whose every item is hidden — the
      // Admin group for an ordinary member — takes its heading with it rather
      // than leaving "ADMIN" floating over nothing.
      const visibleItems = section.items.filter((item) =>
        isNavItemVisible(item, permissions, isModuleEnabled),
      );
      if (visibleItems.length === 0) return null;

      return (
        <div key={section.id} className="space-y-1">
          {section.anchor ? null : (
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              {section.label}
            </p>
          )}
          {visibleItems.map((item) => (
            <ProtectedNavItem
              key={item.id}
              item={item}
              isActive={item.href === pathname}
              permissions={permissions}
              iconClassName={navIconClassName}
              onNavigate={onNavigate}
              focusClassName={sidebarFocusRingClassName}
              isModuleEnabled={isModuleEnabled}
            />
          ))}
        </div>
      );
    });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandMenuOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <ChapterWizardGate />
      <OnboardingTutorial />
      <DashboardCommandMenu
        open={commandMenuOpen}
        onOpenChange={setCommandMenuOpen}
      />
      <DashboardNotificationDrawer
        open={notificationDrawerOpen}
        onOpenChange={setNotificationDrawerOpen}
      />
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        {/*
          A column with one scroll region, mirroring the desktop `<aside>`.
          `SheetContent` is `inset-y-0 h-full` with no overflow of its own, so a
          flat stack put the account block below the fold on a phone — and this
          change moved sign-out, theme, and Profile into that block and removed
          them from the header, so "below the fold" meant "gone". The nav
          scrolls; identity and chapter status stay pinned where they are always
          reachable.
        */}
        <SheetContent
          side="left"
          className="flex flex-col border-border bg-surface-1 px-4 py-6 text-foreground"
        >
          <SheetHeader>
            <SheetTitle className="text-foreground">Navigation</SheetTitle>
            <SheetDescription className="text-muted-foreground">
              Open dashboard routes and chapter tools.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 shrink-0 space-y-2">
            <ChapterLockup />
            <ChapterSwitcher />
          </div>
          <nav className="mt-6 flex-1 space-y-4 overflow-y-auto">
            {renderSections(() => setMobileNavOpen(false))}
          </nav>
          <div className="mt-4 shrink-0 space-y-3 border-t border-border pt-4">
            <AccountMenu
              variant="sheet"
              onNavigate={() => setMobileNavOpen(false)}
            />
            <DashboardChapterPanel variant="sheet" />
          </div>
        </SheetContent>
      </Sheet>
      <a href="#main-content" className={SKIP_LINK_CLASSES}>
        Skip to main content
      </a>
      <div className="mx-auto flex w-full max-w-[1400px]">
        {/*
          The sidebar is the raised nav surface (`--surface-1`, foundations §2)
          with the fixed Signet text ladder — never a chapter-branded fill. The
          legacy `derivePalette` sidebar put stock text on a per-chapter
          surface, which #1150 measured unfixable piecemeal across the 50
          seeded chapters; here the chapter shows itself only through engine
          accent roles whose contrast is guaranteed together at generation.
        */}
        <aside className="hidden min-h-screen w-72 flex-col border-r border-border bg-surface-1 px-3 py-5 text-foreground lg:flex">
          <div className="space-y-2 px-1">
            <ChapterLockup />
            <ChapterSwitcher />
          </div>
          <nav
            aria-label="Primary"
            className="mt-6 flex-1 space-y-4 overflow-y-auto"
          >
            {renderSections()}
          </nav>
          <div className="mt-6 space-y-3 border-t border-border pt-4">
            <AccountMenu variant="sidebar" />
            <DashboardChapterPanel variant="sidebar" />
            {BETA_CONFIG.enabled && BETA_CONFIG.style === "sidebar_pill" ? (
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted">
                  Status
                </span>
                <BetaBadge style="sidebar_pill" />
              </div>
            ) : null}
          </div>
        </aside>

        {/*
          `min-w-0` is load-bearing, not tidying. This column is a flex item, so
          its automatic minimum size is its min-content width — and without the
          override it simply refuses to shrink below whatever the widest
          unbreakable thing on the route needs. The header then never gets a
          reason to shrink either, so the breadcrumb keeps its full width and the
          whole page scrolls sideways.

          That single missing declaration was six of the seven routes in #1142
          (`/documents` 426, `/reports` 408, `/settings` 408, `/study` 392,
          `/service` 390, `/geofences` 383 → all 375). It reads like page-content
          overflow from the outside, which is why it was filed that way; the
          content was only ever the thing supplying the min-content width.
        */}
        <div className="min-h-screen min-w-0 flex-1">
          {/*
            The control cluster collapses below `sm` so the header holds the
            375px floor the responsive contract requires. It did not before:
            hamburger + a text search button + bell + theme + "Sign out" + the
            page's primary action overflowed to ~557px at 375px wide. Folding
            theme and sign-out into the account menu recovered most of it; the
            rest is the search button going icon-only and the primary action —
            which is always also reachable inside the page — standing down.
          */}
          <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
            <div className="flex h-16 items-center justify-between gap-2 px-4 sm:px-6">
              <nav aria-label="Breadcrumb" className="min-w-0">
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <span>Dashboard</span>
                  {crumbLabel && pathname !== "/" ? (
                    <>
                      <ChevronRight
                        className="h-3 w-3 text-muted-foreground/70"
                        aria-hidden="true"
                      />
                      <span>{crumbLabel}</span>
                    </>
                  ) : null}
                </p>
                <h1 className="truncate text-lg font-semibold">{pageTitle}</h1>
              </nav>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation menu"
                  title="Open navigation menu"
                  onClick={() => setMobileNavOpen(true)}
                >
                  <MenuGlyph className={topbarIconClassName} />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="sm:hidden"
                  aria-label="Search commands and resources (Command K)"
                  title="Search commands and resources"
                  onClick={() => setCommandMenuOpen(true)}
                >
                  <SearchGlyph className={topbarIconClassName} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="hidden sm:inline-flex"
                  aria-label="Search commands and resources (Command K)"
                  title="Search commands and resources"
                  onClick={() => setCommandMenuOpen(true)}
                >
                  Search (⌘K)
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={
                    unreadNotifications > 0
                      ? `Notifications (${unreadNotifications} unread)`
                      : "Notifications"
                  }
                  title="Notifications"
                  onClick={() => setNotificationDrawerOpen(true)}
                  className="relative"
                >
                  <NotificationsGlyph className={topbarIconClassName} />
                  {/*
                    Accent, not red: the Canvas reference badges the
                    notification count in the chapter accent (s09) — the
                    mention/DM red is reserved for direct address only
                    (foundations §5).
                  */}
                  {unreadNotifications > 0 ? (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                    >
                      {unreadNotifications > 99 ? "99+" : unreadNotifications}
                    </span>
                  ) : null}
                </Button>
                <AskPill />
                {primaryActionLabel ? (
                  <Button size="sm" className="hidden sm:inline-flex" asChild>
                    <Link href={primaryActionHref}>{primaryActionLabel}</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </header>

          <main id="main-content" className="px-4 py-6 sm:px-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
