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
  ShieldCheck,
} from "lucide-react";
import {
  useCurrentChapter,
  useMyPermissions,
  useNotifications,
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
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  DASHBOARD_NAV,
  DASHBOARD_NAV_BY_HREF,
  type NavItem,
} from "@/components/layout/nav-config";
import { ProtectedNavItem } from "@/components/layout/protected-nav-item";
import { OnboardingTutorial } from "@/components/onboarding/onboarding-tutorial";
import { signOutCurrentSession } from "@/lib/auth/session";
import { useChapterStore } from "@/lib/stores/chapter-store";

type DashboardShellProps = {
  children: React.ReactNode;
};

const sidebarFocusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950";
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
          "border-muted-foreground/40 bg-muted/25 text-muted-foreground",
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
    variant === "sidebar" ? "text-slate-400" : "text-muted-foreground";
  const nameClass = "mt-1 text-sm font-semibold text-white";
  const uniClass = "mt-1 text-xs text-slate-400";
  const shellClass =
    variant === "sidebar"
      ? "mt-10 rounded-lg border border-border bg-navy-900/80 p-4"
      : "mt-8 rounded-lg border border-border bg-navy-900/80 p-4";

  if (!activeChapterId) {
    return (
      <div className={shellClass}>
        <p className={cn("text-xs", labelMuted)}>Chapter</p>
        <p className="mt-2 text-sm text-slate-500">
          Select an active chapter to load branding from the API.
        </p>
      </div>
    );
  }

  if (isPending || (isFetching && data === undefined)) {
    return (
      <div className={shellClass}>
        <p className={cn("text-xs", labelMuted)}>Chapter</p>
        <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-navy-800" />
        <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-navy-800" />
        <div className="mt-4 h-8 w-full animate-pulse rounded-full bg-navy-800" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={shellClass}>
        <p className={cn("text-xs", labelMuted)}>Chapter</p>
        <p className="mt-2 text-sm text-amber-200/90">
          Could not load chapter details.
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Check your session, permissions, and chapter selection.
        </p>
      </div>
    );
  }

  const parsed = CurrentChapterPayloadSchema.safeParse(data);
  if (!parsed.success) {
    return (
      <div className={shellClass}>
        <p className={cn("text-xs", labelMuted)}>Chapter</p>
        <p className="mt-2 text-sm text-amber-200/90">
          Could not load chapter details.
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Check your session, permissions, and chapter selection.
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
      <p className={cn("text-xs", labelMuted)}>Chapter</p>
      <p className={nameClass}>{payload.name}</p>
      <p className={uniClass}>{payload.university}</p>
      <div
        className={cn(
          "mt-3 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
          sub.className,
        )}
      >
        <SubIcon className={statusIconClassName} />
        <span>{sub.label}</span>
      </div>
      {chapterAccent.fallbackApplied ? (
        <p className="mt-2 text-[11px] text-slate-500">
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
  const [isSigningOut, setIsSigningOut] = useState(false);
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data: permissionsPayload } = useMyPermissions({
    enabled: Boolean(activeChapterId),
  });
  const permissions = useMemo(
    () => permissionsPayload?.permissions,
    [permissionsPayload],
  );
  const { data: notificationsData } = useNotifications();
  const unreadNotifications = useMemo(() => {
    if (!Array.isArray(notificationsData)) return 0;
    return (notificationsData as Array<{ read_at?: string | null }>).filter(
      (n) => !n.read_at,
    ).length;
  }, [notificationsData]);

  const activeItem = findNavItemByPath(pathname);
  const pageTitle = activeItem?.breadcrumbTitle ?? activeItem?.label ?? "Dashboard";
  const primaryActionLabel = activeItem?.primaryActionLabel ?? null;
  const primaryActionHref = activeItem?.href ?? pathname;

  function renderSections(onNavigate?: () => void) {
    return DASHBOARD_NAV.map((section) => (
      <div key={section.id} className="space-y-1">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {section.label}
        </p>
        {section.items.map((item) => (
          <ProtectedNavItem
            key={item.id}
            item={item}
            isActive={item.href === pathname}
            permissions={permissions}
            iconClassName={navIconClassName}
            onNavigate={onNavigate}
            focusClassName={sidebarFocusRingClassName}
          />
        ))}
      </div>
    ));
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

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOutCurrentSession();
      window.location.assign("/sign-in");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
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
        <SheetContent
          side="left"
          className="border-border bg-navy-950 px-4 py-6 text-slate-100"
        >
          <SheetHeader>
            <SheetTitle className="text-white">Navigation</SheetTitle>
            <SheetDescription className="text-muted-foreground">
              Open dashboard routes and chapter tools.
            </SheetDescription>
          </SheetHeader>
          <nav className="mt-6 space-y-4">
            {renderSections(() => setMobileNavOpen(false))}
          </nav>
          <DashboardChapterPanel variant="sheet" />
        </SheetContent>
      </Sheet>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to main content
      </a>
      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="hidden min-h-screen w-72 border-r border-border bg-navy-950 px-4 py-6 text-slate-100 lg:block">
          <div className="mb-8 border-b border-border pb-6">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Frapp
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              Operations Console
            </p>
          </div>
          <nav aria-label="Primary" className="space-y-4">
            {renderSections()}
          </nav>

          <DashboardChapterPanel variant="sidebar" />
        </aside>

        <div className="min-h-screen flex-1">
          <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
              <nav aria-label="Breadcrumb">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Dashboard</span>
                  {activeItem && activeItem.href !== "/" ? (
                    <>
                      <ChevronRight
                        className="h-3 w-3 text-muted-foreground/70"
                        aria-hidden="true"
                      />
                      <span>{activeItem.breadcrumbTitle ?? activeItem.label}</span>
                    </>
                  ) : null}
                </p>
                <h1 className="text-lg font-semibold">{pageTitle}</h1>
              </nav>
              <div className="flex items-center gap-2">
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
                  size="sm"
                  className="inline-flex"
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
                <ThemeToggle />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                >
                  {isSigningOut ? "Signing out..." : "Sign out"}
                </Button>
                {primaryActionLabel ? (
                  <Button size="sm" asChild>
                    <Link href={primaryActionHref}>{primaryActionLabel}</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </header>

          <main id="main-content" className="px-5 py-8 sm:px-8 lg:px-10">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
