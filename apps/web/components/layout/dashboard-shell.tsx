"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  CircleDollarSign,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import { useCurrentChapter } from "@repo/hooks";
import { resolveChapterAccentColor } from "@repo/theme/accent";
import { CurrentChapterPayloadSchema } from "@repo/validation";
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
import { useChapterStore } from "@/lib/stores/chapter-store";

type DashboardShellProps = {
  children: React.ReactNode;
};

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  status?: "available" | "coming-soon" | "restricted";
  statusLabel?: string;
};

const navItems = [
  { icon: LayoutDashboard, label: "Overview", href: "/", status: "available" },
  { icon: Users, label: "Members", href: "/members", status: "available" },
  { icon: CalendarDays, label: "Events", href: "/events", status: "available" },
  { icon: Star, label: "Points", href: "/points", status: "available" },
  {
    icon: CircleDollarSign,
    label: "Billing",
    href: "/billing",
    status: "available",
  },
  {
    icon: BookOpen,
    label: "Backwork",
    status: "restricted",
    statusLabel: "Requires docs:view",
  },
  {
    icon: Settings,
    label: "Settings",
    status: "coming-soon",
    statusLabel: "Soon",
  },
] satisfies NavItem[];

const sidebarFocusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950";
const navIconClassName = "h-4 w-4";
const statusIconClassName = "h-3.5 w-3.5";

function withAlpha(hexColor: string, opacity: number): string {
  const normalized = hexColor.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function DashboardChapterPanel({ variant }: { variant: "sidebar" | "sheet" }) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data, isPending, isError, isFetching } = useCurrentChapter({
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

  if (isPending || isFetching) {
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

  const payload = CurrentChapterPayloadSchema.parse(data);
  const chapterAccent = resolveChapterAccentColor(
    payload.accent_color ?? undefined,
  );

  return (
    <div className={shellClass}>
      <p className={cn("text-xs", labelMuted)}>Chapter</p>
      <p className={nameClass}>{payload.name}</p>
      <p className={uniClass}>{payload.university}</p>
      <div
        className="mt-3 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
        style={{
          color: chapterAccent.resolvedAccent,
          borderColor: withAlpha(chapterAccent.resolvedAccent, 0.45),
          backgroundColor: withAlpha(chapterAccent.resolvedAccent, 0.12),
        }}
      >
        <ShieldCheck className={statusIconClassName} />
        <span>Subscription Active</span>
      </div>
      {chapterAccent.fallbackApplied ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Accent adjusted for contrast safety.
        </p>
      ) : null}
    </div>
  );
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const titleByPath: Record<string, string> = {
    "/": "Chapter Operations",
    "/members": "Members",
    "/events": "Events",
    "/points": "Points Ledger",
    "/billing": "Billing",
  };
  const actionByPath: Record<string, string> = {
    "/": "Invite Member",
    "/members": "Invite Member",
    "/events": "New Event",
    "/points": "Adjust Points",
    "/billing": "Create Invoice",
  };
  const pageTitle = titleByPath[pathname] ?? "Dashboard";
  const pageAction = actionByPath[pathname] ?? "Open Action";

  function renderNavItems(onNavigate?: () => void) {
    return navItems.map((item) =>
      item.href ? (
        <Link
          key={item.label}
          href={item.href}
          onClick={onNavigate}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition",
            sidebarFocusRingClassName,
            pathname === item.href
              ? "border-l-2 border-primary bg-primary/15 text-white"
              : "border-l-2 border-transparent text-slate-300 hover:bg-navy-900 hover:text-white",
          )}
        >
          <item.icon className={navIconClassName} />
          <span>{item.label}</span>
        </Link>
      ) : (
        <button
          key={item.label}
          type="button"
          className={cn(
            "flex w-full cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-500",
            sidebarFocusRingClassName,
          )}
          disabled
          title={item.statusLabel}
        >
          <item.icon className={navIconClassName} />
          <span>{item.label}</span>
          {item.statusLabel ? (
            <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {item.statusLabel}
            </span>
          ) : null}
        </button>
      ),
    );
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
    <div className="min-h-screen bg-muted/30">
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
          <nav className="mt-6 space-y-1">
            {renderNavItems(() => setMobileNavOpen(false))}
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
      <div className="mx-auto flex w-full max-w-[1400px]">
        <aside className="hidden min-h-screen w-72 border-r border-border bg-navy-950 px-4 py-6 text-slate-100 lg:block">
          <div className="mb-8 border-b border-border pb-6">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Frapp
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              Operations Console
            </p>
          </div>
          <nav className="space-y-1">{renderNavItems()}</nav>

          <DashboardChapterPanel variant="sidebar" />
        </aside>

        <div className="min-h-screen flex-1">
          <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
            <div className="flex h-16 items-center justify-between px-4 sm:px-6">
              <div>
                <p className="text-sm text-muted-foreground">Dashboard</p>
                <h1 className="text-lg font-semibold">{pageTitle}</h1>
              </div>
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
                  title="Search commands and resources"
                  onClick={() => setCommandMenuOpen(true)}
                >
                  Search (⌘K)
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Notifications"
                  title="Notifications"
                  onClick={() => setNotificationDrawerOpen(true)}
                >
                  <Bell className="h-4 w-4" />
                </Button>
                <ThemeToggle />
                <Button size="sm" asChild>
                  <Link href="#">{pageAction}</Link>
                </Button>
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
