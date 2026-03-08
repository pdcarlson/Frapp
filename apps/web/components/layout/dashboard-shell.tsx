"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, BookOpen, CalendarDays, CircleDollarSign, LayoutDashboard, Settings, ShieldCheck, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DashboardCommandMenu } from "@/components/layout/dashboard-command-menu";

type DashboardShellProps = {
  children: React.ReactNode;
};

const navItems = [
  { icon: LayoutDashboard, label: "Overview", href: "/" },
  { icon: Users, label: "Members", href: "/members" },
  { icon: CalendarDays, label: "Events", href: "/events" },
  { icon: Star, label: "Points", href: "/points" },
  { icon: CircleDollarSign, label: "Billing", href: "/billing" },
  { icon: BookOpen, label: "Backwork", href: "#", soon: true },
  { icon: Settings, label: "Settings", href: "#", soon: true },
];

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to main content
      </a>
      <div className="mx-auto flex w-full max-w-[1400px]">
        <aside className="hidden min-h-screen w-72 border-r border-border bg-slate-950 px-4 py-6 text-slate-100 lg:block">
          <div className="mb-8 px-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Frapp</p>
            <p className="mt-2 text-lg font-semibold text-white">Operations Console</p>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition",
                  pathname === item.href
                    ? "bg-primary/20 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white",
                )}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
                {item.soon ? (
                  <span className="ml-auto rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    Soon
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="mt-10 rounded-lg border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs text-slate-400">Chapter</p>
            <p className="mt-1 text-sm font-semibold text-white">Alpha Beta Chapter</p>
            <p className="mt-1 text-xs text-slate-400">University of State</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Subscription Active</span>
            </div>
          </div>
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
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={() => setCommandMenuOpen(true)}
                >
                  Search (⌘K)
                </Button>
                <Button variant="outline" size="icon" aria-label="Notifications">
                  <Bell className="h-4 w-4" />
                </Button>
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
