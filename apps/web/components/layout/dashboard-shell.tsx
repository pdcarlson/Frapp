"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Ban,
  Bell,
  ChevronRight,
  Clock,
  Menu,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  useCurrentChapter,
  useMyPermissions,
  useNotifications,
  useOrgConfig,
} from "@repo/hooks";
import { resolveChapterAccentColor } from "@repo/theme/accent";
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

const sidebarFocusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-side-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-side-bg";
const navIconClassName = "h-4 w-4";
const statusIconClassName = "h-3.5 w-3.5";

function subscriptionStatusPresentation(
  status: CurrentChapterPayload["subscription_status"],
): {
  label: string;
  className: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  switch (status) {
    case "active":
      return {
        label: "Subscription active",
        className:
          "border-success/45 bg-success/15 text-[hsl(var(--success-foreground))]",
        Icon: ShieldCheck,
      };
    case "past_due":
      return {
        label: "Payment past due",
        className:
          "border-destructive/45 bg-destructive/15 text-[hsl(var(--destructive-foreground))]",
        Icon: AlertCircle,
      };
    case "canceled":
      return {
        label: "Subscription canceled",
        className:
          "border-side-muted/40 bg-side-bg-hi/60 text-side-muted",
        Icon: Ban,
      };
    case "incomplete":
      return {
        label: "Subscription incomplete",
        className:
          "border-primary/45 bg-primary/15 text-[hsl(var(--primary-foreground))]",
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

  const labelMuted =
    variant === "sidebar" ? "text-side-muted" : "text-muted-foreground";
  const shellClass =
    variant === "sidebar"
      ? "rounded-md border border-side-divider bg-side-bg-hi/60 p-3"
      : "mt-8 rounded-md border border-side-divider bg-side-bg-hi/60 p-3";

  if (!activeChapterId) {
    return null;
  }

  if (isPending || (isFetching && data === undefined)) {
    return (
      <div className={shellClass}>
        <p className={cn("text-[10px] uppercase tracking-[0.16em]", labelMuted)}>
          Subscription
        </p>
        <div className="mt-2 h-3 w-3/4 animate-pulse rounded-xs bg-side-bg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={shellClass}>
        <p className={cn("text-[10px] uppercase tracking-[0.16em]", labelMuted)}>
          Subscription
        </p>
        <p className="mt-1.5 text-[11px] text-side-muted">
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
        <p className="mt-1.5 text-[11px] text-side-muted">
          Could not load chapter details.
        </p>
      </div>
    );
  }

  const payload = parsed.data;
  const chapterAccent = resolveChapterAccentColor(
    payload.accent_color ?? undefined,
  );
  const sub = subscriptionStatusPresentation(payload.subscription_status);
  const SubIcon = sub.Icon;

  return (
    <div className={shellClass}>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-[11px]",
          sub.className,
        )}
      >
        <SubIcon className={statusIconClassName} />
        <span>{sub.label}</span>
      </div>
      {chapterAccent.fallbackApplied ? (
        <p className="mt-1.5 text-[10px] text-side-muted">
          Accent adjusted for contrast safety.
        </p>
      ) : null}
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
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-side-muted">
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
          className="flex flex-col border-side-divider bg-side-bg px-4 py-6 text-side-fg"
        >
          <SheetHeader>
            <SheetTitle className="text-side-fg-hi">Navigation</SheetTitle>
            <SheetDescription className="text-side-muted">
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
          <div className="mt-4 shrink-0 space-y-3 border-t border-side-divider pt-4">
            <AccountMenu
              variant="sheet"
              onNavigate={() => setMobileNavOpen(false)}
            />
            <DashboardChapterPanel variant="sheet" />
          </div>
        </SheetContent>
      </Sheet>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to main content
      </a>
      <div className="mx-auto flex w-full max-w-[1400px]">
        <aside className="hidden min-h-screen w-72 flex-col border-r border-side-divider bg-side-bg px-3 py-5 text-side-fg lg:flex">
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
          <div className="mt-6 space-y-3 border-t border-side-divider pt-4">
            <AccountMenu variant="sidebar" />
            <DashboardChapterPanel variant="sidebar" />
            {BETA_CONFIG.enabled && BETA_CONFIG.style === "sidebar_pill" ? (
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] uppercase tracking-[0.16em] text-side-muted">
                  Status
                </span>
                <BetaBadge style="sidebar_pill" />
              </div>
            ) : null}
          </div>
        </aside>

        <div className="min-h-screen flex-1">
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
                  variant="outline"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation menu"
                  title="Open navigation menu"
                  onClick={() => setMobileNavOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="sm:hidden"
                  aria-label="Search commands and resources (Command K)"
                  title="Search commands and resources"
                  onClick={() => setCommandMenuOpen(true)}
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden sm:inline-flex"
                  aria-label="Search commands and resources (Command K)"
                  title="Search commands and resources"
                  onClick={() => setCommandMenuOpen(true)}
                >
                  Search (⌘K)
                </Button>
                <Button
                  variant="outline"
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
                  <Bell className="h-4 w-4" />
                  {unreadNotifications > 0 ? (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
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
