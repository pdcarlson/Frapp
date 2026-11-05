"use client";

import { usePathname } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useMyPermissions, useNotifications } from "@repo/hooks";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SKIP_LINK_CLASSES } from "@/components/ui/focus";
import { AppNav } from "@/components/layout/app-nav";
import { ChatNavColumn } from "@/components/layout/chat-nav-column";
import {
  isChannelsNavRoute,
  NavFaceContext,
  type NavFace,
  type NavFaceContextValue,
} from "@/components/layout/nav-face";
import { TopBar } from "@/components/layout/top-bar";
import { DashboardNotificationDrawer } from "@/components/layout/dashboard-notification-drawer";
import { AccountMenu } from "@/components/layout/account-menu";
import { persistNavCollapsed } from "@/components/layout/nav-collapse";
import { isFullBleedRoute } from "@/components/layout/full-bleed-routes";
import { resolvePageTitle } from "@/components/layout/page-title";
import { isNavItemVisible } from "@/components/layout/protected-nav-item";
import { useChapterTheme } from "@/lib/hooks/use-chapter-theme";
import { useChapterModuleGate } from "@/lib/hooks/use-chapter-module-gate";
import { ChapterWizardGate } from "@/components/onboarding/chapter-wizard-gate";
import { TermsPromptGate } from "@/components/auth/terms-prompt";
import { OnboardingTutorial } from "@/components/onboarding/onboarding-tutorial";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { cn } from "@/lib/utils";

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
 * - **No ⌘K palette and no keydown listener for it.** Find in the top bar is
 *   the replacement: a visible field that opens a centered dialog, as does
 *   Cmd/Ctrl+F, both owned by `find-bar.tsx`. The `cmdk` dependency stays: `components/ui/command.tsx` still
 *   serves the chat slash palette and the chapter wizard.
 * - **The page title is the top bar's**, derived from the route by
 *   `page-title.ts` (2026-11-05). It reads the nav rows' own labels rather
 *   than keeping a table of its own, and a route it does not know gets no
 *   title rather than a made-up one: the "a route with no nav row is called
 *   Dashboard" defect stays retired.
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
  const fullBleed = isFullBleedRoute(pathname);
  // Chapter accent, shell-wide: maps the persisted engine roles onto the
  // semantic tokens signet.css defines. Mounted here (not in ChatProvider) so
  // the nav's active-item tint does not depend on which route is open.
  useChapterTheme();

  const [navCollapsed, setNavCollapsed] = useState(defaultNavCollapsed);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // `/chat`'s left column is the channel list, with the module nav one back
  // arrow away (`nav-face.tsx`). The face is remembered per pathname, so every
  // arrival at Chat opens on the channels, and it is derived rather than reset
  // in an effect, so there is no frame of the old face after navigating.
  const channelsNav = isChannelsNavRoute(pathname);
  const [faceState, setFaceState] = useState<{ face: NavFace; path: string }>({
    face: "channels",
    path: pathname,
  });
  const face: NavFace =
    faceState.path === pathname ? faceState.face : "channels";
  const [channelsSlot, setChannelsSlot] = useState<HTMLElement | null>(null);
  const navFace = useMemo<NavFaceContextValue | null>(
    () =>
      channelsNav
        ? {
            face,
            showModules: () =>
              setFaceState({ face: "modules", path: pathname }),
            showChannels: () =>
              setFaceState({ face: "channels", path: pathname }),
            channelsSlot,
          }
        : null,
    [channelsNav, face, pathname, channelsSlot],
  );

  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data: permissionsPayload } = useMyPermissions({
    enabled: Boolean(activeChapterId),
  });
  const permissions = useMemo(
    () => permissionsPayload?.permissions,
    [permissionsPayload],
  );
  // Module gating: items tied to a disabled module hide once the chapter read
  // resolves. Undefined while loading means "do not gate", so nothing flashes
  // out during the initial load. Read from the member-readable current chapter,
  // never the officer-only config read (#1982; the hook says why).
  const isModuleEnabled = useChapterModuleGate();
  // The crumb's parent link follows its nav row's gates, so the top bar never
  // offers a member the Settings door the nav hides from them.
  const pageTitle = useMemo(
    () =>
      resolvePageTitle(pathname, (item) =>
        isNavItemVisible(item, permissions, isModuleEnabled),
      ),
    [pathname, permissions, isModuleEnabled],
  );

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
      The visible viewport's height. The connection banner floats over the
      page (`offline-banner.tsx`) and takes no layout space, so nothing here
      makes room for it. This used to subtract the banner's published height,
      and that is exactly what moved the whole shell down every time the state
      left ONLINE (#2244). `data-dashboard-shell` is how the banner knows to sit
      below the top bar instead of over it.

      `dvh`, not `vh`: on a phone browser whose toolbar can hide, `100vh` is
      the viewport with the toolbar hidden, so a shell that clips its overflow
      would put chat's composer under the toolbar while it shows.
    */
    <div
      data-dashboard-shell=""
      className="flex h-dvh overflow-hidden bg-background"
    >
      <ChapterWizardGate />
      {/* A member who hasn't accepted the current Terms (#2302). */}
      <TermsPromptGate />
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
        {navFace ? (
          <ChatNavColumn
            face={navFace.face}
            onShowChannels={navFace.showChannels}
            channelsSlotRef={setChannelsSlot}
            permissions={permissions}
            isModuleEnabled={isModuleEnabled}
            pathname={pathname}
          />
        ) : (
          <AppNav
            collapsed={navCollapsed}
            onToggleCollapsed={toggleNavCollapsed}
            permissions={permissions}
            isModuleEnabled={isModuleEnabled}
            pathname={pathname}
          />
        )}
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
          pageTitle={pageTitle}
          unreadNotifications={unreadNotifications}
          onOpenNotifications={() => setNotificationDrawerOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        {/*
          The content column scrolls independently of the nav, which is what
          makes the nav's own scroll position survive navigation. `min-h-0` is
          the flex-child counterpart of `min-w-0` and is what actually lets this
          element scroll instead of growing the page.

          A full-bleed route (`full-bleed-routes.ts`) gets the same landmark
          with no inset and no scroll: it is handed the frame and owns what
          happens inside it. That is the only way chat's channels column can sit
          flush against the nav and its composer can pin to the bottom of the
          viewport instead of the bottom of a scrolling document.
        */}
        <main
          id="main-content"
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            fullBleed
              ? "overflow-hidden"
              : "gap-3 overflow-y-auto px-4 py-4 sm:px-6",
          )}
        >
          <NavFaceContext.Provider value={navFace}>
            {children}
          </NavFaceContext.Provider>
        </main>
      </div>
    </div>
  );
}
