"use client";

import { usePathname } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useMyPermissions, useNotifications, useOrgConfig } from "@repo/hooks";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SKIP_LINK_CLASSES } from "@/components/ui/focus";
import { AppNav } from "@/components/layout/app-nav";
import { TopBar } from "@/components/layout/top-bar";
import { DashboardNotificationDrawer } from "@/components/layout/dashboard-notification-drawer";
import { AccountMenu } from "@/components/layout/account-menu";
import { persistNavCollapsed } from "@/components/layout/nav-collapse";
import { useChapterTheme } from "@/lib/hooks/use-chapter-theme";
import { ChapterWizardGate } from "@/components/onboarding/chapter-wizard";
import { OnboardingTutorial } from "@/components/onboarding/onboarding-tutorial";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * The greenfield dashboard shell: flush-left nav, 48px top bar, content.
 *
 * Three flush columns rather than a centered page. The previous shell wrapped
 * everything in `mx-auto max-w-[1400px]`, which on a wide display left the nav
 * floating in from the left edge with background either side of it. The board
 * seats the nav against the viewport edge (`1b`: "three flush columns, 100vh,
 * independent scroll") and lets content use the width it has.
 *
 * What this shell deliberately no longer does:
 *
 * - **No ⌘K palette and no keydown listener for it.** The find field in the top
 *   bar is the replacement, on Cmd/Ctrl+F, and it is visible rather than
 *   summoned. The `cmdk` dependency stays: `components/ui/command.tsx` still
 *   serves the chat slash palette and the chapter wizard.
 * - **No page title.** Routes name themselves with `PageHeader`. The shell has
 *   no route-to-title map any more, which also retires the "a route with no nav
 *   row is called Dashboard" defect rather than patching it again.
 * - **No account menu in the nav, no subscription card, no BETA row.** Identity
 *   moved to the top-bar avatar; the other two are deleted outright (`1t`).
 *
 * The responsive contract is unchanged: two states, switching once at `lg`.
 * Below it the nav lives in a drawer and the rail never appears; the drawer
 * renders the same `AppNav`, so navigation is never duplicated into a second
 * list that can drift.
 */

type DashboardShellProps = {
  children: React.ReactNode;
  /**
   * Collapse preference, read from a cookie by the server layout so the first
   * paint is already correct. Reading it on the client instead would render
   * 220px and then snap to 56px after hydration, on every route.
   */
  defaultNavCollapsed?: boolean;
};

export function DashboardShell({
  children,
  defaultNavCollapsed = false,
}: DashboardShellProps) {
  const pathname = usePathname();
  // Chapter accent, shell-wide: maps the persisted engine roles onto the
  // semantic tokens signet.css defines. Mounted here (not in ChatProvider) so
  // the nav's active-item tint does not depend on which route is open.
  useChapterTheme();

  const [navCollapsed, setNavCollapsed] = useState(defaultNavCollapsed);
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
  // Module gating: items tied to a disabled module hide once the chapter config
  // resolves. Undefined while loading means "do not gate", so nothing flashes
  // out during the initial load.
  const orgConfig = useOrgConfig();
  const isModuleEnabled = orgConfig.data?.isModuleEnabled;

  const { data: notificationsData } = useNotifications();
  const unreadNotifications = useMemo(() => {
    if (!Array.isArray(notificationsData)) return 0;
    return (notificationsData as Array<{ read_at?: string | null }>).filter(
      (n) => !n.read_at,
    ).length;
  }, [notificationsData]);

  const toggleNavCollapsed = useCallback(() => {
    // The cookie write is deliberately OUTSIDE the updater. React requires an
    // updater to be pure and double-invokes it under Strict Mode; the write is
    // idempotent so nothing breaks today, but a side effect in that position is
    // the kind that starts misbehaving the moment it stops being idempotent.
    setNavCollapsed((prev) => !prev);
    persistNavCollapsed(!navCollapsed);
  }, [navCollapsed]);

  return (
    /*
      Height is the viewport MINUS the offline banner, not a flat `h-screen`.
      `OfflineBanner` renders as a sibling above this shell in the root layout
      and publishes its own height as `--offline-banner-height` (0px when it is
      unmounted). A flat 100vh here would add the banner's height to the page
      the moment the app goes offline, pushing the bottom of the shell below the
      fold and giving the body a scrollbar it otherwise never has (#1746 is the
      same banner, from the other direction).
    */
    <div className="flex h-[calc(100vh_-_var(--offline-banner-height,0px))] overflow-hidden bg-background">
      <ChapterWizardGate />
      <OnboardingTutorial />
      <DashboardNotificationDrawer
        open={notificationDrawerOpen}
        onOpenChange={setNotificationDrawerOpen}
      />

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        {/*
          The drawer is the sidebar: it renders the same `AppNav`, never a
          second hand-maintained list. It supplies the scroll container and the
          account block, which on desktop live in the top bar instead.
        */}
        <SheetContent
          side="left"
          className="flex flex-col border-border bg-surface-1 p-2 text-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>
              Open dashboard routes and chapter tools.
            </SheetDescription>
          </SheetHeader>
          <AppNav
            variant="drawer"
            collapsed={false}
            permissions={permissions}
            isModuleEnabled={isModuleEnabled}
            pathname={pathname}
            onNavigate={() => setMobileNavOpen(false)}
          />
          <div className="mt-2 shrink-0 border-t border-border pt-2">
            <AccountMenu
              variant="sheet"
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <a href="#main-content" className={SKIP_LINK_CLASSES}>
        Skip to main content
      </a>

      <div className="hidden lg:flex">
        <AppNav
          collapsed={navCollapsed}
          onToggleCollapsed={toggleNavCollapsed}
          permissions={permissions}
          isModuleEnabled={isModuleEnabled}
          pathname={pathname}
        />
      </div>

      {/*
        `min-w-0` is load-bearing, not tidying. This column is a flex item, so
        its automatic minimum size is its min-content width — without the
        override it refuses to shrink below whatever the widest unbreakable
        thing on the route needs, and the whole page scrolls sideways. That one
        missing declaration was six of the seven routes in #1142.
      */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          unreadNotifications={unreadNotifications}
          onOpenNotifications={() => setNotificationDrawerOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        {/*
          The content column scrolls independently of the nav, which is what
          makes the nav's own scroll position survive navigation. `min-h-0` is
          the flex-child counterpart of `min-w-0` and is what actually lets this
          element scroll instead of growing the page.
        */}
        <main
          id="main-content"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
