"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signetDarkTokens } from "@repo/theme/signet";
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
import { NavColumn } from "@/components/layout/nav-column";
import {
  FULL_NAV_SPLIT_QUERY,
  isChatRoute,
  PANE_FLOOR,
  CHANNELS_WIDTH,
  SPLIT_QUERY,
  useMediaQueryState,
} from "@/components/layout/shell-layout";
import {
  persistChatOpen,
  persistToolShare,
} from "@/components/layout/shell-prefs";
import { SplitDivider } from "@/components/layout/split-divider";
import { ChapterHome } from "@/components/layout/chapter-home";
import { ChatPanelBoundary } from "@/components/layout/chat-panel-boundary";
import { ChatPage } from "@/components/chat/chat-page";
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
import { NoAccessRedirect } from "@/components/layout/no-access-redirect";
import { TermsPromptGate } from "@/components/auth/terms-prompt";
import { OnboardingTutorial } from "@/components/onboarding/onboarding-tutorial";
import { WhatsNewHost } from "@/components/whats-new/whats-new-host";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useChatRealtimeBinding } from "@/lib/chat/use-chat-realtime-binding";
import { useNavHighlights } from "@/components/layout/use-chat-has-unread";
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
 * **Chat is a panel of the shell, not a page** (#3779, Paul 2026-11-10). The
 * nav column always stays; its Chat row opens and closes the chat panel, and
 * a tool row opens its page beside chat, on the right, with a divider between
 * them. Chat and one tool can be open; with neither, the home view
 * (`chapter-home.tsx`). `shell-layout.ts` owns the state model: the open tool
 * is the URL, chat open or closed and the divider are cookies.
 *
 * The responsive contract: below `lg` the nav lives in a drawer and the rail
 * never appears; the drawer renders the same `AppNav`, so navigation is never
 * duplicated into a second list that can drift. Below the side-by-side width
 * (`SPLIT_MIN_WIDTH`) the shell is a single page: `/chat` is chat, a tool
 * route is its tool, and the Chat row is a link.
 */

/**
 * The drawer's nav, with the rows that have something new lit (#3824). Its
 * own component so the unread reads redraw the drawer, not the shell; the
 * sheet mounts it only while open.
 */
function DrawerNav(
  props: Pick<
    React.ComponentProps<typeof AppNav>,
    "permissions" | "isModuleEnabled" | "pathname" | "onNavigate"
  >,
) {
  const highlighted = useNavHighlights();
  return (
    <AppNav
      variant="drawer"
      collapsed={false}
      highlighted={highlighted}
      {...props}
    />
  );
}

type DashboardShellProps = {
  children: React.ReactNode;
  /**
   * Collapse preference, read from a cookie by the server layout so the first
   * paint is already correct. Reading it on the client instead would render
   * 240px and then snap to 56px after hydration, on every route.
   */
  defaultNavCollapsed?: boolean;
  /** Chat open or closed, from its cookie (`shell-layout.ts`). */
  defaultChatOpen?: boolean;
  /** The divider's tool-page share, from its cookie. */
  defaultToolShare?: number;
  /** Chat's member column preference (`lib/chat/members-panel.ts`). */
  defaultMembersHidden?: boolean;
};

/** Chat's panel enters and leaves with the standard Signet tokens. */
const PANEL_ENTER_MS = signetDarkTokens.motion.duration.context;
const PANEL_EXIT_MS = signetDarkTokens.motion.duration.standard;

export function DashboardShell({
  children,
  defaultNavCollapsed = false,
  defaultChatOpen = true,
  defaultToolShare = 0.5,
  defaultMembersHidden = false,
}: DashboardShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const fullBleed = isFullBleedRoute(pathname);
  // Chapter accent, shell-wide: maps the persisted engine roles onto the
  // semantic tokens signet.css defines. Mounted here (not in ChatProvider) so
  // the nav's active-item tint does not depend on which route is open.
  useChapterTheme();
  // Chat's inbox, joined on every page, so a message arriving while the member
  // is on Events lights the nav's Chat row within seconds (#3745).
  useChatRealtimeBinding();

  const [navCollapsed, setNavCollapsed] = useState(defaultNavCollapsed);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Side by side: `null` until the client knows its width, so a hydration
  // render never unmounts chat beside a tool page.
  const split = useMediaQueryState(SPLIT_QUERY);
  const fullNavRoom = useMediaQueryState(FULL_NAV_SPLIT_QUERY);
  const onChatRoute = isChatRoute(pathname);
  const hasTool = !onChatRoute;

  const [chatOpen, setChatOpen] = useState(defaultChatOpen);
  const [toolShare, setToolShare] = useState(defaultToolShare);
  const splitRowRef = useRef<HTMLDivElement>(null);

  /*
    Arriving at a chat URL opens chat: a `/chat` link, a notification, a Find
    result, the directory's Message action. The one arrival that must not is
    the shell's own, closing a tool (`closeTool`), which goes to `/chat`
    meaning "no tool" and leaves chat as it was. Adjusted during render, keyed
    on the URL, so there is no frame of the home view first.
  */
  const url = `${pathname}?${searchParams?.toString() ?? ""}`;
  const [seenUrl, setSeenUrl] = useState(url);
  const [closingTool, setClosingTool] = useState(false);
  if (seenUrl !== url) {
    setSeenUrl(url);
    if (closingTool) setClosingTool(false);
    else if (onChatRoute && !chatOpen) setChatOpen(true);
  }
  // The cookie follows the state, whichever way it changed.
  useEffect(() => {
    persistChatOpen(chatOpen);
  }, [chatOpen]);

  /*
    Closing plays the exit before the panel unmounts. `leaving` is the panel
    still on screen while it fades and slides out.
  */
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  // Only an open the member asked for plays the entrance; a page load or a
  // link that opens chat paints it in place.
  const [animateOpen, setAnimateOpen] = useState(false);
  const toggleChat = useCallback(() => {
    if (chatOpen) setLeaving(true);
    else setAnimateOpen(true);
    setChatOpen(!chatOpen);
  }, [chatOpen]);
  const closeTool = useCallback(() => {
    setClosingTool(true);
    router.push("/chat");
  }, [router]);

  const chatShown = chatOpen || leaving;
  // Mounted: alone on `/chat` below the side-by-side width whatever the
  // cookie says (the single page), and beside a tool only when open there.
  const chatMounted = onChatRoute
    ? chatShown || split !== true
    : chatShown && split !== false;
  // The rail, forced while chat and a tool share a window too narrow for the
  // full nav beside both 375px floors.
  const forceRail =
    hasTool && chatOpen && split === true && fullNavRoom === false;

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

  const chatPanelClassName = cn(
    "flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
    onChatRoute
      ? // Alone: the whole row. Closed, it still shows below the
        // side-by-side width, where `/chat` is the chat page.
        cn("flex-1", !chatShown && "min-[1056px]:hidden")
      : // Beside a tool: from the side-by-side width up only.
        "hidden shrink min-[1056px]:flex",
  );
  const chatPanelStyle: React.CSSProperties = {
    // Keyframes in `app/globals.css`, off under reduced motion.
    animation: leaving
      ? `shell-panel-out ${PANEL_EXIT_MS}ms ${signetDarkTokens.motion.easing.exit} forwards`
      : animateOpen
        ? `shell-panel-in ${PANEL_ENTER_MS}ms ${signetDarkTokens.motion.easing.entrance}`
        : undefined,
    ...(hasTool
      ? {
          // The channels column, then the messages' part of what is left.
          // CSS holds both floors: chat never below channels + 375, and the
          // tool page (`min-w-[375px]`) never below 375, whatever the share.
          flexBasis: `calc(${CHANNELS_WIDTH}px + (100% - ${CHANNELS_WIDTH + 1}px) * ${(1 - toolShare).toFixed(4)})`,
          minWidth: CHANNELS_WIDTH + PANE_FLOOR,
        }
      : {}),
  };
  const showDivider = hasTool && chatShown && split !== false;
  const skipTarget =
    onChatRoute && (chatShown || split !== true)
      ? "#chat-panel"
      : "#main-content";

  return (
    /*
      The visible viewport's height. The connection pill sits in the top bar
      (`connection-pill.tsx`) and takes no row of its own, so nothing here
      makes room for it. This used to subtract the banner's published height,
      and that is exactly what moved the whole shell down every time the state
      left ONLINE (#2244). `data-dashboard-shell` is how the root layout's
      floating pill knows to stand down while the bar carries one.

      `dvh`, not `vh`: on a phone browser whose toolbar can hide, `100vh` is
      the viewport with the toolbar hidden, so a shell that clips its overflow
      would put chat's composer under the toolbar while it shows.
    */
    <div
      data-dashboard-shell=""
      className="flex h-dvh overflow-hidden bg-background"
    >
      <ChapterWizardGate />
      {/* A member whose roles grant nothing (#3236). */}
      <NoAccessRedirect />
      {/* A member who hasn't accepted the current Terms (#2302). */}
      <TermsPromptGate />
      <OnboardingTutorial />
      {/* What's new, by itself once after an update (#3943). */}
      <WhatsNewHost />
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
          <DrawerNav
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

      <a href={skipTarget} className={SKIP_LINK_CLASSES}>
        Skip to main content
      </a>

      {/*
        The nav column always stays (#3779): one column on every route, so
        nothing in it jumps going in and out of Chat.
      */}
      <div className="hidden lg:flex">
        <NavColumn
          collapsed={navCollapsed || forceRail}
          onToggleCollapsed={forceRail ? undefined : toggleNavCollapsed}
          permissions={permissions}
          isModuleEnabled={isModuleEnabled}
          pathname={pathname}
          chatRow={
            split === true
              ? { onSelect: toggleChat, open: chatOpen }
              : undefined
          }
          onCloseTool={split === true && hasTool ? closeTool : undefined}
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
          // The home view is no page: "Chat" over it would name what's closed.
          pageTitle={
            onChatRoute && !chatShown && split === true ? null : pageTitle
          }
          unreadNotifications={unreadNotifications}
          onOpenNotifications={() => setNotificationDrawerOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <div ref={splitRowRef} className="flex min-h-0 flex-1">
          {chatMounted ? (
            <section
              id="chat-panel"
              aria-label="Chat"
              data-chat-panel=""
              inert={leaving}
              className={chatPanelClassName}
              style={chatPanelStyle}
            >
              <ChatPanelBoundary>
                <ChatPage
                  defaultMembersHidden={defaultMembersHidden}
                  toolBeside={hasTool}
                />
              </ChatPanelBoundary>
            </section>
          ) : null}
          {showDivider ? (
            <div className="hidden min-[1056px]:flex">
              <SplitDivider
                share={toolShare}
                onChange={setToolShare}
                onCommit={persistToolShare}
                rowRef={splitRowRef}
              />
            </div>
          ) : null}
          {/*
            The tool page. It scrolls independently of the nav, which is what
            makes the nav's own scroll position survive navigation. `min-w-0`
            and `min-h-0` are load-bearing: as flex items, without them this
            refuses to shrink below its widest unbreakable content and the
            whole page scrolls sideways (six of the seven routes in #1142).
            Beside chat it keeps the 375px floor.

            On `/chat` there is no tool page: `<main>` holds the home view when
            chat is closed, from the side-by-side width up, and is hidden
            otherwise (the page itself renders nothing; chat is the panel).
          */}
          <main
            id="main-content"
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              hasTool && chatShown && "min-[1056px]:min-w-[375px]",
              onChatRoute
                ? cn(
                    "overflow-hidden",
                    chatShown ? "hidden" : "hidden min-[1056px]:flex",
                  )
                : fullBleed
                  ? "overflow-hidden"
                  : "gap-3 overflow-y-auto px-4 py-4 sm:px-6",
            )}
          >
            {onChatRoute ? (chatShown ? null : <ChapterHome />) : children}
          </main>
        </div>
      </div>
    </div>
  );
}
